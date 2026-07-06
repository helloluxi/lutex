import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { findAvailablePort, addCorsHeaders, handleOptionsRequest } from '../listener/http';

export type RendererKind = 'tex' | 'md' | 'slides';

const RES_DIR: Record<RendererKind, string> = { tex: 'tex', md: 'md', slides: 'sd' };

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.tex': 'text/plain',
    '.bib': 'text/plain',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
};

function contentType(filePath: string): string {
    return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function isRendererKind(value: string | null): value is RendererKind {
    return value === 'tex' || value === 'md' || value === 'slides';
}

/** Parse the `?macros=` query param (a JSON object); malformed or absent input yields undefined. */
function parseMacros(raw: string | null): Record<string, string> | undefined {
    if (!raw) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

interface IndexConfig {
    file?: string;
    theme: string | null;
    macros?: Record<string, string>;
}

/**
 * Inject the `window.lutex*` config before the first `<script>` (JSON.stringify guards quotes).
 * Listener integration (`window.lutexListenerPort`) is deliberately not injected here — the daemon
 * serving this page has no notion of a listener; pages fall back to parsing `?o=` themselves.
 */
function injectIndex(template: string, cfg: IndexConfig): string {
    let script = '<script>\n';
    if (cfg.file) {
        script += `        window.lutexMarkdownFile = ${JSON.stringify(cfg.file)};\n`;
    }
    if (cfg.theme) {
        script += `        window.lutexDefaultTheme = ${JSON.stringify(cfg.theme)};\n`;
    }
    if (cfg.macros) {
        script += `        window.lutexKatexMacros = ${JSON.stringify(cfg.macros)};\n`;
    }
    script += '    </script>\n    <script>';
    return template.replace('<script>', script);
}

export interface AssetResponderDeps {
    log: (msg: string) => void;
    /** Called when a new source root is registered (the daemon uses it to start a file watcher). */
    onRootAdded?: (dir: string) => void;
}

/**
 * Serves the renderer pages and their assets over GET. The page is served at `/?view=<kind>` so
 * relative assets resolve to root paths; bundled assets come from `res/`+`node_modules/`, and source
 * files resolve by absolute path (markdown injects an absolute file) or against a registered root
 * (tex/slides fetch relative). Mounted both inside the daemon and in the slides-pdf throwaway server.
 */
export class AssetResponder {
    private readonly roots = new Set<string>();
    private readonly pkgRoot: string;

    constructor(private readonly deps: AssetResponderDeps) {
        // __dirname is out/renderer; resources live at the package root.
        this.pkgRoot = path.join(__dirname, '..', '..');
    }

    addRoot(dir: string): void {
        const resolved = path.resolve(dir);
        if (!this.roots.has(resolved)) {
            this.roots.add(resolved);
            this.deps.onRootAdded?.(resolved);
        }
    }

    respond(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = new URL(req.url || '/', 'http://localhost');
        const pathname = decodeURIComponent(url.pathname);

        if (pathname === '/' || pathname === '/index.html') {
            const view = url.searchParams.get('view');
            if (!isRendererKind(view)) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('lutex daemon. Open /?view=md|tex|slides&file=...');
                return;
            }
            this.serveIndex(view, url.searchParams, res);
            return;
        }

        const filePath = this.resolveBundled(pathname) ?? this.resolveSource(pathname);
        if (!filePath) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }
        fs.readFile(filePath, (err, data) => {
            if (err) {
                const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
                res.writeHead(notFound ? 404 : 500, { 'Content-Type': 'text/plain' });
                res.end(notFound ? `File not found: ${filePath}` : 'Internal server error');
                return;
            }
            res.writeHead(200, { 'Content-Type': contentType(filePath) });
            res.end(data);
        });
    }

    private serveIndex(kind: RendererKind, params: URLSearchParams, res: http.ServerResponse): void {
        const file = params.get('file') ?? undefined;
        if (kind === 'tex') {
            const root = params.get('root');
            if (root) {
                this.addRoot(root);
            }
        } else if (file) {
            const dir = path.dirname(file);
            this.addRoot(dir);
            if (kind === 'slides' && params.get('dump') === '1') {
                this.dumpSlidesStatic(path.resolve(dir));
            }
        }

        const indexPath = path.join(this.pkgRoot, 'res', RES_DIR[kind], 'index.html');
        fs.readFile(indexPath, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }
            const html = injectIndex(data, {
                file,
                theme: params.get('m'),
                macros: parseMacros(params.get('macros')),
            });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        });
    }

    /** Bundled assets: `/dist`, `/katex`, `/prism`, and any `*.css` (searched across the res dirs). */
    private resolveBundled(pathname: string): string | null {
        if (pathname.startsWith('/dist/')) {
            return path.join(this.pkgRoot, 'res', 'dist', pathname.slice('/dist/'.length));
        }
        if (pathname.startsWith('/katex/')) {
            return path.join(this.pkgRoot, 'node_modules', 'katex', 'dist', pathname.slice('/katex/'.length));
        }
        if (pathname.startsWith('/prism/')) {
            return path.join(this.pkgRoot, 'node_modules', 'prismjs', pathname.slice('/prism/'.length));
        }
        if (pathname.endsWith('.css')) {
            const base = path.basename(pathname);
            for (const kind of Object.values(RES_DIR)) {
                const candidate = path.join(this.pkgRoot, 'res', kind, base);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    /** Source files: an absolute path (markdown injects one), else relative to a registered root. */
    private resolveSource(pathname: string): string | null {
        if (path.isAbsolute(pathname) && fs.existsSync(pathname)) {
            return pathname;
        }
        for (const root of this.roots) {
            const candidate = path.join(root, pathname);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /** Copy sdRenderer.js + sd.css into {workspace}/dist/ and write {workspace}/index.html. */
    private dumpSlidesStatic(root: string): void {
        const distDir = path.join(root, 'dist');
        try {
            fs.mkdirSync(distDir, { recursive: true });
            fs.copyFileSync(
                path.join(this.pkgRoot, 'res', 'dist', 'sdRenderer.js'),
                path.join(distDir, 'sdRenderer.js'),
            );
            fs.copyFileSync(
                path.join(this.pkgRoot, 'res', 'sd', 'sd.css'),
                path.join(distDir, 'sd.css'),
            );
            const template = fs.readFileSync(path.join(this.pkgRoot, 'res', 'sd', 'index.html'), 'utf8');
            fs.writeFileSync(
                path.join(root, 'index.html'),
                template.replace('href="sd.css"', 'href="./dist/sd.css"'),
                'utf8',
            );
        } catch (err) {
            this.deps.log(`[assets] could not dump slides static assets to ${root}: ${err}`);
        }
    }
}

/**
 * Minimal standalone renderer used by `slides-pdf` so PDF export works without a running daemon.
 * Returns the bound port and a stop function; the browser↔daemon integration is disabled.
 */
export async function startStandaloneRenderer(opts: {
    root: string;
    hostname?: string;
    log: (msg: string) => void;
}): Promise<{ port: number; stop: () => void }> {
    const responder = new AssetResponder({ log: opts.log });
    responder.addRoot(opts.root);

    const server = http.createServer((req, res) => {
        addCorsHeaders(res, 'GET, OPTIONS');
        if (req.method === 'OPTIONS') {
            handleOptionsRequest(res);
            return;
        }
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method not allowed');
            return;
        }
        responder.respond(req, res);
    });

    const hostname = opts.hostname ?? '127.0.0.1';
    const port = await findAvailablePort(hostname);
    await new Promise<void>((resolve, reject) => {
        server.listen(port, hostname, () => resolve()).on('error', reject);
    });
    return { port, stop: () => server.close() };
}
