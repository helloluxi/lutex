import * as http from 'http';
import * as vscode from 'vscode';
import { jumpToLine, toggleCheckbox } from './fileNavigation';
import { findAvailablePort, parseLineNumber, addCorsHeaders, handleOptionsRequest, sendErrorResponse } from './tools';
import { getServerHostname } from './settings';

export class ListenerServer {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;
    private port: number | null = null;
    private connectedClients: Set<http.ServerResponse> = new Set();

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            // Add CORS headers
            addCorsHeaders(res, 'POST, GET, OPTIONS');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                handleOptionsRequest(res);
                return;
            }

            if (req.method === 'POST' && (req.url === '/' || req.url === '/jump')) {
                this.handlePostRequest(req, res);
            } else if (req.method === 'GET' && req.url === '/event') {
                this.handleRefreshEventStream(req, res);
            } else {
                this.outputChannel.appendLine(`[Listener Server] Method not allowed: ${req.method} ${req.url}`);
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
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { file, line, action = 'jump' } = data;
                this.outputChannel.appendLine(`[Listener Server] Received ${action} request { file: ${file}, line: ${line} }`);
                
                const lineNumber = parseLineNumber(line, res, this.outputChannel);
                if (lineNumber === null) return;
                
                if (file && typeof file === 'string' && lineNumber > 0) {
                    if (action === 'check') {
                        toggleCheckbox(file, lineNumber, this.outputChannel);
                    } else {
                        jumpToLine(file, lineNumber, this.outputChannel);
                    }
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Success');
                } else {
                    const errorMsg = 'Invalid request format. Expected JSON with file (string) and line (number > 0) properties.';
                    this.outputChannel.appendLine(`[Listener Server] Error: ${errorMsg}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(errorMsg);
                }
            } catch (error) {
                const errorMsg = `Error processing HTTP data: ${error}`;
                this.outputChannel.appendLine(`[Listener Server] ${errorMsg}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        });
    }

    private handleRefreshEventStream(req: http.IncomingMessage, res: http.ServerResponse): void {
        // Set up Server-Sent Events (SSE)
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // Add this client to the set of connected clients
        this.connectedClients.add(res);

        // Send initial connection message
        res.write('data: {"type":"connected"}\n\n');

        // Handle client disconnect
        req.on('close', () => {
            this.connectedClients.delete(res);
        });
    }

    public notifyRefresh(): void {
        this.connectedClients.forEach(client => {
            try {
                client.write('data: {"type":"refresh"}\n\n');
            } catch (error) {
                // Silently remove failed clients
                this.connectedClients.delete(client);
            }
        });
    }

    public notifyScroll(file: string, line: number): void {
        const message = JSON.stringify({ type: 'scroll', file, line });
        this.connectedClients.forEach(client => {
            try {
                client.write(`data: ${message}\n\n`);
            } catch (error) {
                // Silently remove failed clients
                this.connectedClients.delete(client);
            }
        });
    }

    public notifyClose(): void {
        this.connectedClients.forEach(client => {
            try {
                client.write('data: {"type":"close"}\n\n');
            } catch (error) {
                // Silently remove failed clients
                this.connectedClients.delete(client);
            }
        });
    }



    public async start(port?: number): Promise<number> {
        let currentPort = port;
        const hostname = getServerHostname();
        
        while (true) {
            try {
                const actualPort = currentPort || await findAvailablePort(hostname);
                
                // Recreate server for each attempt to avoid binding issues
                this.server = this.createServer();
                
                const serverPort = await new Promise<number>((resolve, reject) => {
                    this.server.listen(actualPort, hostname, () => {
                        this.port = actualPort;
                        this.outputChannel.appendLine(`[Listener Server] Listener started on port ${actualPort}`);
                        resolve(actualPort);
                    }).on('error', (err: NodeJS.ErrnoException) => {
                        this.outputChannel.appendLine(`[Listener Server] Error starting server on port ${actualPort}: ${err.message}`);
                        reject(err);
                    });
                });
                
                return serverPort;
            } catch (error) {
                if (currentPort) {
                    // Increment port and try again
                    currentPort++;
                    this.outputChannel.appendLine(`[Listener Server] Retrying with port ${currentPort}...`);
                } else {
                    // Auto-detect mode failed, this shouldn't happen but log it
                    this.outputChannel.appendLine('[Listener Server] Auto-detect port failed, retrying...');
                }
            }
        }
    }

    public stop(): void {
        if (this.server) {
            this.outputChannel.appendLine('[Listener Server] Stopping listener server...');
            // Notify all connected clients to close
            this.notifyClose();
            // Give clients a moment to receive the close signal
            setTimeout(() => {
                this.server.close();
                this.connectedClients.clear();
                this.port = null;
            }, 100);
        }
    }

    public getPort(): number | null {
        return this.port;
    }

    public isRunning(): boolean {
        return this.port !== null;
    }
}