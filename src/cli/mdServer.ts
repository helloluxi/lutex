import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

/** Fixed port for the shared `md` daemon. One process serves every file. */
export const MD_DAEMON_PORT = 9988;

/** Daemon build version (from package.json) — a stale daemon is replaced when this changes. */
export const MD_VERSION: string = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version ?? '0';
    } catch {
        return '0';
    }
})();

/**
 * The shared `md` daemon: one long-lived process on a fixed port that renders any markdown file.
 * The file is chosen per-request via `?f=<absolute path>` (not baked in), so a single browser tab —
 * and a single process — can switch between files and survive tab closes. Each served file is
 * watched on disk; a change pushes a `refresh` over the `/event` SSE so open tabs live-reload.
 */
export class MdServerCli {
    private server: http.Server;
    private port: number | null = null;
    private resourcesPath: string;
    private distResourcesPath: string;
    private katexPath: string;
    private prismPath: string;
    private sseClients: Set<http.ServerResponse> = new Set();
    private watchers: Map<string, fs.FSWatcher> = new Map();
    private debounce: Map<string, NodeJS.Timeout> = new Map();

    constructor() {
        this.resourcesPath = path.join(__dirname, '../../res/md');
        this.distResourcesPath = path.join(__dirname, '../../res/dist');
        this.katexPath = path.join(__dirname, '../../node_modules/katex/dist');
        this.prismPath = path.join(__dirname, '../../node_modules/prismjs');
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
            if (req.method === 'GET') { this.handleGetRequest(req, res); }
            else { res.writeHead(405); res.end('Method not allowed'); }
        });
    }

    private handleSseRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write('data: {"type":"connected"}\n\n');
        this.sseClients.add(res);
        // The daemon outlives its clients — closing the last tab must NOT stop the process.
        req.on('close', () => { this.sseClients.delete(res); });
    }

    private handleGetRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (!req.url) { res.writeHead(400); res.end(); return; }

        const url = new URL(req.url, `http://localhost:${this.port}`);
        const pathname = url.pathname;

        let filePath: string;
        let contentType: string;

        if (pathname === '/' || pathname === '/index.html') {
            const file = url.searchParams.get('f');
            this.serveIndexHtml(file, url.searchParams.get('m') ?? 'dark', res);
            return;
        } else if (pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, version: MD_VERSION }));
            return;
        } else if (pathname === '/quit') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Stopping');
            this.stop();
            return;
        } else if (pathname === '/event') {
            this.handleSseRequest(req, res);
            return;
        } else if (pathname.startsWith('/dist/')) {
            filePath = path.join(this.distResourcesPath, pathname.substring(6));
            contentType = 'application/javascript';
        } else if (pathname.startsWith('/katex/')) {
            filePath = path.join(this.katexPath, pathname.substring(7));
            contentType = this.getContentType(pathname);
        } else if (pathname.startsWith('/prism/')) {
            filePath = path.join(this.prismPath, pathname.substring(7));
            contentType = this.getContentType(pathname);
        } else if (pathname.endsWith('.css')) {
            filePath = path.join(this.resourcesPath, path.basename(pathname));
            contentType = 'text/css';
        } else {
            // Absolute filesystem path — used for .md files and images resolved by mdRenderer
            filePath = decodeURIComponent(pathname);
            contentType = this.getContentType(pathname);
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found: ' + filePath);
            return;
        }

        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(500); res.end('Internal server error'); return; }
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    private getContentType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: { [key: string]: string } = {
            '.md': 'text/markdown',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.png': 'image/png',
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
            '.ttf': 'font/ttf',
        };
        return map[ext] ?? 'application/octet-stream';
    }

    private serveIndexHtml(file: string | null, themeMode: string, res: http.ServerResponse): void {
        const absFile = file ? path.resolve(file) : '';
        if (absFile) { this.ensureWatch(absFile); }

        const indexPath = path.join(this.resourcesPath, 'index.html');
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) { res.writeHead(500); res.end('Internal server error'); return; }

            // The standalone daemon has no listener port, so the page's own EventSource stays off.
            // Inject a self-contained SSE client: live-reload on `refresh` for this file, close on `close`.
            const configScript = `<script>
        window.lutexMarkdownFile = ${JSON.stringify(absFile)};
        window.lutexDefaultTheme = ${JSON.stringify(themeMode)};
        const _es = new EventSource('/event');
        _es.addEventListener('message', e => {
            try {
                const d = JSON.parse(e.data);
                if (d.type === 'close') { window.close(); return; }
                if (d.type === 'refresh' && (!d.file || d.file === window.lutexMarkdownFile)) {
                    try {
                        const hs = [...document.querySelectorAll('h2, h3')];
                        const a = hs.findLast(h => h.getBoundingClientRect().top <= 1);
                        if (a) localStorage.setItem('mdScrollHeading', a.textContent.trim());
                        else localStorage.removeItem('mdScrollHeading');
                    } catch {}
                    location.reload();
                }
            } catch {}
        });
    </script>
    <script>`;

            const html = data.replace('<script>', configScript);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        });
    }

    /** Watch a served file so on-disk edits push a `refresh` to open tabs. Idempotent per file. */
    private ensureWatch(absFile: string): void {
        if (this.watchers.has(absFile) || !fs.existsSync(absFile)) { return; }
        try {
            const watcher = fs.watch(absFile, () => {
                const prev = this.debounce.get(absFile);
                if (prev) { clearTimeout(prev); }
                this.debounce.set(absFile, setTimeout(() => {
                    this.debounce.delete(absFile);
                    // Editors often replace the file (rename), which invalidates the watch — re-arm.
                    if (!fs.existsSync(absFile)) { return; }
                    if (!this.watchers.has(absFile)) { this.ensureWatch(absFile); }
                    this.broadcast(JSON.stringify({ type: 'refresh', file: absFile }));
                }, 50));
            });
            watcher.on('error', () => {
                this.watchers.get(absFile)?.close();
                this.watchers.delete(absFile);
            });
            this.watchers.set(absFile, watcher);
        } catch {
            // unwatchable path (e.g. deleted between checks) — ignore
        }
    }

    private broadcast(message: string): void {
        for (const client of this.sseClients) {
            try { client.write(`data: ${message}\n\n`); }
            catch { this.sseClients.delete(client); }
        }
    }

    public broadcastShutdown(): void {
        this.broadcast('{"type":"close"}');
    }

    public async start(port: number = MD_DAEMON_PORT): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.listen(port, 'localhost', () => {
                this.port = port;
                resolve(port);
            }).on('error', reject);
        });
    }

    /** Tell open tabs to close, then tear down the daemon. */
    public stop(): void {
        this.broadcastShutdown();
        for (const w of this.watchers.values()) { w.close(); }
        this.watchers.clear();
        setTimeout(() => {
            this.server.close();
            process.exit(0);
        }, 150);
    }
}
