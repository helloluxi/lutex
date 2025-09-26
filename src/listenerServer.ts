import * as http from 'http';
import * as vscode from 'vscode';
import { jumpToLine } from './fileNavigation';
import { findAvailablePort, parseLineNumber, addCorsHeaders, handleOptionsRequest, sendErrorResponse, PORT_RANGES } from './tools';

export class ListenerServer {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;
    private port: number | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            // Add CORS headers
            addCorsHeaders(res, 'POST, OPTIONS');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                handleOptionsRequest(res);
                return;
            }

            if (req.method === 'POST') {
                this.handlePostRequest(req, res);
            } else {
                this.outputChannel.appendLine(`[Listener Server] Method not allowed: ${req.method}`);
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
                const { file, line } = data;
                this.outputChannel.appendLine(`[Listener Server] Received jump request { file: ${file}, line: ${line} }`);
                
                const lineNumber = parseLineNumber(line, res, this.outputChannel);
                if (lineNumber === null) return;
                
                if (file && typeof file === 'string' && lineNumber > 0) {
                    jumpToLine(file, lineNumber, this.outputChannel);
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



    public async start(port?: number): Promise<number> {
        try {
            const actualPort = port || await findAvailablePort(PORT_RANGES.LISTENER.start, PORT_RANGES.LISTENER.max);
            
            return new Promise((resolve, reject) => {
                this.server.listen(actualPort, 'localhost', () => {
                    this.port = actualPort;
                    this.outputChannel.appendLine(`[Listener Server] Listener started on port ${actualPort}`);
                    resolve(actualPort);
                }).on('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE') {
                        const errorMsg = `Port ${actualPort} is already in use. Server not started.`;
                        this.outputChannel.appendLine(`[Listener Server] Error starting server: ${errorMsg}`);
                        reject(new Error(errorMsg));
                    } else {
                        const errorMsg = `Error starting server: ${err}`;
                        this.outputChannel.appendLine(`[Listener Server] Error starting server: ${errorMsg}`);
                        reject(new Error(errorMsg));
                    }
                });
            });
        } catch (error) {
            const errorMsg = `Failed to find available port: ${error}`;
            this.outputChannel.appendLine(`[Listener Server] ${errorMsg}`);
            throw error;
        }
    }

    public stop(): void {
        if (this.server) {
            this.outputChannel.appendLine('[Listener Server] Stopping listener server...');
            this.server.close();
            this.port = null;
        }
    }

    public getPort(): number | null {
        return this.port;
    }

    public isRunning(): boolean {
        return this.port !== null;
    }
}