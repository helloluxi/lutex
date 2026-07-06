import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AssetResponder } from './assets';
import { RootWatcher } from './watch';
import { addCorsHeaders, handleOptionsRequest } from '../listener/http';

/** Daemon build version (from package.json) — a stale daemon is replaced when this changes. */
export const VIEW_VERSION: string = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version ?? '0';
    } catch {
        return '0';
    }
})();

/**
 * The shared view daemon: one long-lived process, reachable from any workspace, that renders any
 * md/tex/slides file via `?view=<kind>&file=<path>` (or `&root=` for tex). It has no notion of the
 * nvim listener — jump/scroll integration is attached client-side via `?o=<listenerPort>` (see
 * res/md/index.html, res/sd/index.html, and the tex bundle). Each served root is watched on disk; a
 * change pushes a `refresh` over the `/event` SSE so open tabs live-reload.
 */
export class ViewServerCli {
    private server: http.Server;
    private sseClients: Set<http.ServerResponse> = new Set();
    private readonly watcher: RootWatcher;
    private readonly assets: AssetResponder;

    constructor() {
        this.watcher = new RootWatcher((file) => this.broadcastRefresh(file), (msg) => console.error(msg));
        this.assets = new AssetResponder({
            log: (msg) => console.error(msg),
            onRootAdded: (dir) => this.watcher.watch(dir),
        });
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            addCorsHeaders(res, 'GET, OPTIONS');
            if (req.method === 'OPTIONS') { handleOptionsRequest(res); return; }
            if (req.method !== 'GET') {
                res.writeHead(405, { 'Content-Type': 'text/plain' });
                res.end('Method not allowed');
                return;
            }

            const pathname = new URL(req.url || '/', 'http://localhost').pathname;
            if (pathname === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, version: VIEW_VERSION }));
            } else if (pathname === '/quit') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Stopping');
                this.stop();
            } else if (pathname === '/event') {
                this.handleSseRequest(req, res);
            } else {
                this.assets.respond(req, res);
            }
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

    private broadcastRefresh(file: string): void {
        this.broadcast(JSON.stringify({ type: 'refresh', file }));
    }

    private broadcast(message: string): void {
        for (const client of this.sseClients) {
            try { client.write(`data: ${message}\n\n`); }
            catch { this.sseClients.delete(client); }
        }
    }

    public start(port: number): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server.listen(port, 'localhost', () => resolve(port)).on('error', reject);
        });
    }

    /** Tell open tabs to close, then tear down the daemon. */
    public stop(): void {
        this.broadcast('{"type":"close"}');
        this.watcher.close();
        setTimeout(() => {
            this.server.close();
            process.exit(0);
        }, 150);
    }
}

/** GET a daemon endpoint, resolving null if it is unreachable within the timeout. */
function probe(port: number, pathname: string, timeoutMs = 500): Promise<{ status: number; body: string } | null> {
    return new Promise((resolve) => {
        const req = http.get({ host: 'localhost', port, path: pathname, timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/** Poll `predicate` every 100ms, up to `attempts` times, resolving true as soon as it does. */
async function waitUntil(predicate: () => Promise<boolean>, attempts: number): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
        if (await predicate()) { return true; }
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

function spawnDaemon(port: number): void {
    const child = spawn(process.execPath, [__filename, '--port', String(port)], { detached: true, stdio: 'ignore' });
    child.unref();
}

/** Ensure a daemon of the current version is listening on `port`, spawning (or replacing) one if needed. */
export async function ensureViewDaemon(port: number): Promise<void> {
    const health = await probe(port, '/health');
    if (health?.status === 200) {
        try {
            const { version } = JSON.parse(health.body);
            if (version === VIEW_VERSION) { return; }
        } catch { /* malformed health — treat as stale */ }
        // A stale daemon is running an older build; replace it.
        await probe(port, '/quit');
        await waitUntil(async () => !(await probe(port, '/health')), 30);
    }

    spawnDaemon(port);
    if (!(await waitUntil(async () => (await probe(port, '/health'))?.status === 200, 50))) {
        throw new Error(`view daemon failed to start on :${port}`);
    }
}

/** Stop the daemon on `port`, if one is running. Returns whether one was actually stopped. */
export async function stopViewDaemon(port: number): Promise<boolean> {
    return (await probe(port, '/quit')) !== null;
}

/** Unconditionally restart the daemon on `port`, regardless of version match. */
export async function reloadViewDaemon(port: number): Promise<void> {
    await probe(port, '/quit');
    await waitUntil(async () => !(await probe(port, '/health')), 30);

    spawnDaemon(port);
    if (!(await waitUntil(async () => (await probe(port, '/health'))?.status === 200, 50))) {
        throw new Error(`view daemon failed to restart on :${port}`);
    }
}

// Invoked directly by `spawnDaemon` as `node viewServer.js --port <n>` — runs the daemon in the
// foreground. Not a public CLI entry point; `lutex md|tex|slides|reload|stop` go through the
// exported functions above instead.
if (require.main === module) {
    const idx = process.argv.indexOf('--port');
    const port = idx >= 0 ? Number(process.argv[idx + 1]) : NaN;
    if (!Number.isInteger(port) || port <= 0) {
        console.error('[lutex] viewServer requires --port <n>');
        process.exit(1);
    }

    const server = new ViewServerCli();
    server.start(port)
        .then(() => console.error(`[lutex] view daemon ${VIEW_VERSION} on http://localhost:${port}`))
        .catch(() => {
            // Lost the race — another daemon already owns the port. Nothing to do.
            process.exit(0);
        });
    process.on('SIGINT', () => server.stop());
    process.on('SIGTERM', () => server.stop());
}
