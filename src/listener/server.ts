import * as http from 'http';
import { NvimController, NvimUnreachable } from './nvim';
import { addCorsHeaders, handleOptionsRequest, parseLineNumber } from './http';

export interface ListenerDeps {
    nvim: NvimController;
    /** Log sink — replaces the VSCode OutputChannel of the original extension. */
    log: (msg: string) => void;
}

/**
 * The nvim jump listener: one process per nvim instance. POST `/`+`/jump` (jump/check) keep the
 * byte-identical wire contract; jump/check are awaited so an unreachable nvim is reported as 502
 * while the daemon stays up. POST `/scroll` and GET `/event` carry cursor-follow scroll events to
 * the browser preview. Content serving and file-watching live entirely in the shared view daemon
 * (`src/cli/viewServer.ts`) now — this class knows nothing about rendering.
 */
export class ListenerServer {
    private server: http.Server | null = null;
    private readonly nvim: NvimController;
    private readonly log: (msg: string) => void;
    private port: number | null = null;
    private connectedClients: Set<http.ServerResponse> = new Set();

    constructor({ nvim, log }: ListenerDeps) {
        this.nvim = nvim;
        this.log = log;
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            addCorsHeaders(res, 'POST, GET, OPTIONS');

            if (req.method === 'OPTIONS') {
                handleOptionsRequest(res);
                return;
            }

            if (req.method === 'POST' && (req.url === '/' || req.url === '/jump')) {
                this.handlePostRequest(req, res);
            } else if (req.method === 'POST' && req.url === '/scroll') {
                this.handleScrollRequest(req, res);
            } else if (req.method === 'GET' && req.url === '/event') {
                this.handleScrollEventStream(req, res);
            } else {
                this.log(`[Listener Server] Method not allowed: ${req.method} ${req.url}`);
                res.writeHead(405, { 'Content-Type': 'text/plain' });
                res.end('Method not allowed');
            }
        });
    }

    private handlePostRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { file, line, action = 'jump' } = data;
                this.log(`[Listener Server] Received ${action} request { file: ${file}, line: ${line} }`);

                const lineNumber = parseLineNumber(line);
                if (lineNumber === null) {
                    const errorMsg = `Invalid line number: ${line}. Must be a valid number.`;
                    this.log(`[Listener Server] Error: ${errorMsg}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(errorMsg);
                    return;
                }

                if (!(file && typeof file === 'string' && lineNumber > 0)) {
                    const errorMsg = 'Invalid request format. Expected JSON with file (string) and line (number > 0) properties.';
                    this.log(`[Listener Server] Error: ${errorMsg}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(errorMsg);
                    return;
                }

                if (action !== 'check' && action !== 'jump') {
                    this.log(`[Listener Server] Unknown action: ${action}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Unknown action');
                    return;
                }

                try {
                    const ok = action === 'check'
                        ? await this.nvim.check(file, lineNumber)
                        : await this.nvim.jump(file, lineNumber);
                    if (!ok) {
                        const errorMsg = action === 'check'
                            ? `Could not toggle checkbox: file not found or no checkbox at line ${lineNumber}`
                            : `Could not jump: file not found (${file})`;
                        this.log(`[Listener Server] ${errorMsg}`);
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end(errorMsg);
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Success');
                } catch (err) {
                    if (!(err instanceof NvimUnreachable)) {
                        throw err;
                    }
                    const errorMsg = `nvim unreachable: ${err.message}`;
                    this.log(`[Listener Server] ${errorMsg}`);
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end(errorMsg);
                }
            } catch (error) {
                const errorMsg = `Error processing HTTP data: ${error}`;
                this.log(`[Listener Server] ${errorMsg}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        });
    }

    // POST /scroll {file,line} lets the editor push a cursor-follow SSE event to the browser.
    private handleScrollRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = body ? JSON.parse(body) : {};
                const line = parseLineNumber(data.line);
                if (!data.file || typeof data.file !== 'string' || line === null || line <= 0) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('scroll requires JSON { file (string), line (number > 0) }');
                    return;
                }
                this.notifyScroll(data.file, line);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Success');
            } catch (error) {
                this.log(`[Listener Server] Error processing scroll data: ${error}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        });
    }

    private handleScrollEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        this.connectedClients.add(res);
        res.write('data: {"type":"connected"}\n\n');

        req.on('close', () => {
            this.connectedClients.delete(res);
        });
    }

    public notifyScroll(file: string, line: number): void {
        this.broadcast(JSON.stringify({ type: 'scroll', file, line }));
    }

    public notifyClose(): void {
        this.broadcast('{"type":"close"}');
    }

    private broadcast(message: string): void {
        this.connectedClients.forEach(client => {
            try {
                client.write(`data: ${message}\n\n`);
            } catch {
                this.connectedClients.delete(client);
            }
        });
    }

    /** Bind `port`, auto-incrementing past a busy port. Returns the actually bound port. */
    public async start(port: number, hostname: string): Promise<number> {
        let currentPort = port;
        for (;;) {
            try {
                this.server = this.createServer();
                return await new Promise<number>((resolve, reject) => {
                    this.server!.listen(currentPort, hostname, () => {
                        this.port = currentPort;
                        this.log(`[Listener Server] Listener started on port ${currentPort}`);
                        resolve(currentPort);
                    }).on('error', (err: NodeJS.ErrnoException) => {
                        this.log(`[Listener Server] Error starting server on port ${currentPort}: ${err.message}`);
                        reject(err);
                    });
                });
            } catch {
                currentPort++;
                this.log(`[Listener Server] Retrying with port ${currentPort}...`);
            }
        }
    }

    public stop(): void {
        if (!this.server) {
            return;
        }
        this.log('[Listener Server] Stopping listener server...');
        this.notifyClose();
        // Give clients a moment to receive the close signal before tearing down.
        setTimeout(() => {
            this.server?.close();
            this.connectedClients.clear();
            this.port = null;
        }, 100);
    }

    public getPort(): number | null {
        return this.port;
    }

    public isRunning(): boolean {
        return this.port !== null;
    }
}
