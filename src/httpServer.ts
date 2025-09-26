import * as http from 'http';
import * as vscode from 'vscode';
import { jumpToLine } from './fileNavigation';

export class HttpServerManager {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            // Add CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === 'POST') {
                this.handlePostRequest(req, res);
            } else {
                this.outputChannel.appendLine(`[HTTP Server] Method not allowed: ${req.method}`);
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
                this.outputChannel.appendLine(`[HTTP Server] Received jump request { file: ${file}, line: ${line} }`);
                
                const lineNumber = this.parseLineNumber(line, res);
                if (lineNumber === null) return;
                
                if (file && typeof file === 'string' && lineNumber > 0) {
                    jumpToLine(file, lineNumber, this.outputChannel);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Success');
                } else {
                    const errorMsg = 'Invalid request format. Expected JSON with file (string) and line (number > 0) properties.';
                    this.outputChannel.appendLine(`[HTTP Server] Error: ${errorMsg}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(errorMsg);
                }
            } catch (error) {
                const errorMsg = `Error processing HTTP data: ${error}`;
                this.outputChannel.appendLine(`[HTTP Server] ${errorMsg}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
            }
        });
    }

    private parseLineNumber(line: any, res: http.ServerResponse): number | null {
        let lineNumber: number;
        if (typeof line === 'number') {
            lineNumber = line;
        } else if (typeof line === 'string') {
            lineNumber = parseInt(line, 10);
            if (isNaN(lineNumber)) {
                const errorMsg = `Invalid line number: ${line}. Must be a valid number.`;
                this.outputChannel.appendLine(`[HTTP Server] Error: ${errorMsg}`);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end(errorMsg);
                return null;
            }
        } else {
            const errorMsg = `Invalid line type: ${typeof line}. Must be a number or string.`;
            this.outputChannel.appendLine(`[HTTP Server] Error: ${errorMsg}`);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(errorMsg);
            return null;
        }
        return lineNumber;
    }

    public start(port: number): void {
        this.server.listen(port, 'localhost', () => {
            this.outputChannel.appendLine(`[HTTP Server] Server started on port ${port}`);
        }).on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                const errorMsg = `Port ${port} is already in use. Server not started.`;
                this.outputChannel.appendLine(`[HTTP Server] Error starting server: ${errorMsg}`);
                vscode.window.showErrorMessage(errorMsg);
            } else {
                const errorMsg = `Error starting server: ${err}`;
                this.outputChannel.appendLine(`[HTTP Server] Error starting server: ${errorMsg}`);
                vscode.window.showErrorMessage(errorMsg);
            }
        });
    }

    public stop(): void {
        this.outputChannel.appendLine('[HTTP Server] Extension deactivating, closing server...');
        this.server.close();
    }
}