import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { jumpToLine } from './fileNavigation';
import { findAvailablePort, parseLineNumber, addCorsHeaders, handleOptionsRequest, sendErrorResponse, PORT_RANGES } from './tools';

export class RendererServer {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;
    private resourcesPath: string;
    private port: number | null = null;

    constructor(outputChannel: vscode.OutputChannel, extensionPath: string) {
        this.outputChannel = outputChannel;
        this.resourcesPath = path.join(extensionPath, 'resources', 'web');
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            // Add CORS headers
            addCorsHeaders(res, 'GET, POST, OPTIONS');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                handleOptionsRequest(res);
                return;
            }

            if (req.method === 'POST') {
                this.handlePostRequest(req, res);
            } else if (req.method === 'GET') {
                this.handleGetRequest(req, res);
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
                
                const lineNumber = parseLineNumber(line, res, this.outputChannel);
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

    private handleGetRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (!req.url) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request');
            return;
        }

        // Parse URL to extract query parameters
        const url = new URL(req.url, `http://localhost:${this.port}`);
        const pathname = url.pathname;

        // Get the current workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('No workspace folder found');
            return;
        }

        let filePath: string;
        
        if (pathname === '/' || pathname === '/index.html') {
            // Serve the main HTML file with potential modifications for listener port
            filePath = path.join(this.resourcesPath, 'index.html');
            
            // If listener parameter is provided, modify the HTML to include it
            const listenerPort = url.searchParams.get('listener');
            if (listenerPort) {
                this.serveModifiedIndexHtml(filePath, listenerPort, res);
                return;
            }
        } else if (pathname.startsWith('/src/')) {
            // Serve files from the src directory
            filePath = path.join(this.resourcesPath, pathname);
        } else if (pathname === '/main.tex' || pathname.endsWith('.tex') || pathname.endsWith('.bib')) {
            // Serve LaTeX files from the workspace
            const fileName = pathname.startsWith('/') ? pathname.substring(1) : pathname;
            filePath = path.join(workspaceFolder.uri.fsPath, fileName);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            if (pathname === '/main.tex') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('main.tex not found in workspace. Please ensure your LaTeX project has a main.tex file.');
                return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }

        // Determine content type
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/plain';
        switch (ext) {
            case '.html':
                contentType = 'text/html';
                break;
            case '.js':
                contentType = 'application/javascript';
                break;
            case '.css':
                contentType = 'text/css';
                break;
            case '.tex':
            case '.bib':
                contentType = 'text/plain';
                break;
        }

        // Read and serve the file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[HTTP Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    private serveModifiedIndexHtml(filePath: string, listenerPort: string, res: http.ServerResponse): void {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[Renderer Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            // Inject listener port as a global variable in the HTML
            const modifiedHtml = data.replace(
                /<script>/,
                `<script>
        // Listener port configuration
        window.lutexListenerPort = ${parseInt(listenerPort)};
    </script>
    <script>`
            );

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(modifiedHtml);
        });
    }

    public async start(port?: number): Promise<number> {
        try {
            this.port = port || await findAvailablePort(PORT_RANGES.RENDERER.start, PORT_RANGES.RENDERER.max);
            
            return new Promise((resolve, reject) => {
                this.server.listen(this.port!, 'localhost', () => {
                    this.outputChannel.appendLine(`[Renderer Server] LaTeX renderer server started on port ${this.port}`);
                    this.outputChannel.appendLine(`[Renderer Server] Access at: http://localhost:${this.port}`);
                    resolve(this.port!);
                }).on('error', (err: NodeJS.ErrnoException) => {
                    const errorMsg = `Error starting server: ${err.message}`;
                    this.outputChannel.appendLine(`[Renderer Server] ${errorMsg}`);
                    reject(err);
                });
            });
        } catch (error) {
            const errorMsg = `Failed to find available port: ${error}`;
            this.outputChannel.appendLine(`[Renderer Server] ${errorMsg}`);
            throw error;
        }
    }

    public stop(): void {
        if (this.server) {
            this.outputChannel.appendLine('[Renderer Server] Stopping LaTeX renderer server...');
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