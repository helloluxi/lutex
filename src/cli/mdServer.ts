import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

function findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const startPort = 12023;
        let attemptCount = 0;
        const tryPort = (port: number) => {
            if (attemptCount++ >= 100) { reject(new Error('No available port found')); return; }
            const s = http.createServer();
            s.listen(port, 'localhost', () => s.close(() => resolve(port)));
            s.on('error', () => tryPort(port + 1));
        };
        tryPort(startPort);
    });
}

export class MdServerCli {
    private server: http.Server;
    private port: number | null = null;
    private filePath: string;
    private resourcesPath: string;
    private distResourcesPath: string;
    private katexPath: string;
    private prismPath: string;
    private sseClients: Set<http.ServerResponse> = new Set();

    constructor(filePath: string) {
        this.filePath = path.resolve(filePath);
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
        req.on('close', () => {
            this.sseClients.delete(res);
            if (this.sseClients.size === 0) {
                this.server.close();
                process.exit(0);
            }
        });
    }

    private handleGetRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (!req.url) { res.writeHead(400); res.end(); return; }

        const url = new URL(req.url, `http://localhost:${this.port}`);
        const pathname = url.pathname;

        let filePath: string;
        let contentType: string;

        if (pathname === '/' || pathname === '/index.html') {
            this.serveIndexHtml(url.searchParams.get('m') ?? 'dark', res);
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
            filePath = pathname;
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

    private serveIndexHtml(themeMode: string, res: http.ServerResponse): void {
        const indexPath = path.join(this.resourcesPath, 'index.html');
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) { res.writeHead(500); res.end('Internal server error'); return; }

            const configScript = `<script>
        window.lutexMarkdownFile = '${this.filePath}';
        window.lutexDefaultTheme = '${themeMode}';
        const _es = new EventSource('/event');
        _es.addEventListener('message', e => { try { if (JSON.parse(e.data).type === 'close') window.close(); } catch {} });
    </script>
    <script>`;

            const html = data.replace('<script>', configScript);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        });
    }

    public broadcastShutdown(): void {
        for (const client of this.sseClients) {
            client.write('data: {"type":"close"}\n\n');
        }
    }

    public async start(): Promise<number> {
        const port = await findAvailablePort();
        return new Promise((resolve, reject) => {
            this.server.listen(port, 'localhost', () => {
                this.port = port;
                resolve(port);
            }).on('error', reject);
        });
    }
}
