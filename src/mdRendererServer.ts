import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findAvailablePort, addCorsHeaders, handleOptionsRequest } from './tools';

export class MdRendererServer {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;
    private resourcesPath: string;
    private distResourcesPath: string;
    private port: number | null = null;

    constructor(outputChannel: vscode.OutputChannel, extensionPath: string) {
        this.outputChannel = outputChannel;
        this.resourcesPath = path.join(extensionPath, 'res', 'md');
        this.distResourcesPath = path.join(extensionPath, 'res', 'dist');
        this.server = this.createServer();
    }

    private createServer(): http.Server {
        return http.createServer((req, res) => {
            // Add CORS headers
            addCorsHeaders(res, 'GET, OPTIONS');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                handleOptionsRequest(res);
                return;
            }

            if (req.method === 'GET') {
                this.handleGetRequest(req, res);
            } else {
                this.outputChannel.appendLine(`[Markdown Server] Method not allowed: ${req.method}`);
                res.writeHead(405, { 'Content-Type': 'text/plain' });
                res.end('Method not allowed');
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
            // Serve the main HTML file with potential modifications for theme and listener port
            filePath = path.join(this.resourcesPath, 'index.html');
            
            // Get URL parameters (using 'f' for file, 'o' for listener port, and 'm' for theme mode)
            const markdownFile = url.searchParams.get('f');
            const listenerPort = url.searchParams.get('o');
            const themeMode = url.searchParams.get('m');
            
            if (markdownFile || listenerPort || themeMode) {
                this.serveModifiedIndexHtml(filePath, markdownFile, listenerPort, themeMode, res);
                return;
            }
        } else if (pathname.startsWith('/dist/')) {
            // Serve compiled JS files from dist directory
            const jsFileName = pathname.substring(6); // Remove '/dist/'
            filePath = path.join(this.distResourcesPath, jsFileName);
        } else if (pathname.endsWith('.css')) {
            // Serve CSS files from resources directory
            filePath = path.join(this.resourcesPath, pathname.substring(1));
        } else if (pathname === '/main.md' || pathname.endsWith('.md')) {
            // Serve markdown files from the workspace
            const fileName = pathname.startsWith('/') ? pathname.substring(1) : pathname;
            filePath = path.join(workspaceFolder.uri.fsPath, fileName);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found');
            return;
        }

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            if (pathname === '/main.md') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('main.md not found in workspace. Please ensure your workspace has a main.md file.');
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
            case '.ts':
                contentType = 'application/typescript';
                break;
            case '.css':
                contentType = 'text/css';
                break;
            case '.md':
                contentType = 'text/markdown';
                break;
        }

        // Read and serve the file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[Markdown Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    private serveModifiedIndexHtml(filePath: string, markdownFile: string | null, listenerPort: string | null, themeMode: string | null, res: http.ServerResponse): void {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[Markdown Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            // Build configuration script
            let configScript = '<script>\n';
            
            if (markdownFile) {
                configScript += `        // Markdown file configuration\n`;
                configScript += `        window.lutexMarkdownFile = '${markdownFile}';\n`;
            }
            
            if (listenerPort) {
                configScript += `        // Listener port configuration\n`;
                configScript += `        window.lutexListenerPort = ${parseInt(listenerPort)};\n`;
            }
            
            if (themeMode) {
                configScript += `        // Theme mode configuration\n`;
                configScript += `        window.lutexDefaultTheme = '${themeMode}';\n`;
            }
            
            configScript += '    </script>\n    <script>';

            // Inject configuration as a global variable in the HTML
            const modifiedHtml = data.replace(
                /<script>/,
                configScript
            );

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(modifiedHtml);
        });
    }

    public async start(port?: number): Promise<number> {
        const tryStart = async (): Promise<number> => {
            const actualPort = port || await findAvailablePort();
            
            return new Promise((resolve, reject) => {
                this.server.listen(actualPort, 'localhost', () => {
                    this.port = actualPort;
                    this.outputChannel.appendLine(`[Markdown Server] Markdown renderer server started on port ${this.port}`);
                    this.outputChannel.appendLine(`[Markdown Server] Access at: http://localhost:${this.port}`);
                    resolve(this.port!);
                }).on('error', (err: NodeJS.ErrnoException) => {
                    this.outputChannel.appendLine(`[Markdown Server] Error starting server on port ${actualPort}: ${err.message}`);
                    reject(err);
                });
            });
        };

        // Keep retrying until successful
        while (true) {
            try {
                return await tryStart();
            } catch (error) {
                // If a specific port was requested and failed, throw the error
                if (port) {
                    const errorMsg = `Failed to start markdown server on port ${port}: ${error}`;
                    this.outputChannel.appendLine(`[Markdown Server] ${errorMsg}`);
                    throw new Error(errorMsg);
                }
                // Otherwise, retry with a new random port
                this.outputChannel.appendLine('[Markdown Server] Retrying with a new port...');
            }
        }
    }

    public stop(): void {
        if (this.server) {
            this.outputChannel.appendLine('[Markdown Server] Stopping markdown renderer server...');
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
