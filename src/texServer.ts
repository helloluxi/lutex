import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { jumpToLine } from './fileNavigation';
import { findAvailablePort, parseLineNumber, addCorsHeaders, handleOptionsRequest, sendErrorResponse } from './tools';
import { getKatexMacrosFromSettings, getServerHostname } from './settings';

export class TexServer {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;
    private resourcesPath: string;
    private distResourcesPath: string;
    private port: number | null = null;

    constructor(outputChannel: vscode.OutputChannel, extensionPath: string) {
        this.outputChannel = outputChannel;
        this.resourcesPath = path.join(extensionPath, 'res', 'tex');
        this.distResourcesPath = path.join(extensionPath, 'res', 'dist');
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
            // Serve the main HTML file with potential modifications for listener port and theme
            filePath = path.join(this.resourcesPath, 'index.html');
            
            // Get URL parameters (using 'o' for port and 'm' for theme mode)
            const listenerPort = url.searchParams.get('o');
            const themeMode = url.searchParams.get('m');
            
            if (listenerPort || themeMode) {
                this.serveModifiedIndexHtml(filePath, listenerPort, themeMode, res);
                return;
            }
        } else if (pathname.startsWith('/dist/')) {
            // Serve compiled JS files from dist directory
            const jsFileName = pathname.substring(6); // Remove '/dist/'
            filePath = path.join(this.distResourcesPath, jsFileName);
        } else if (pathname.endsWith('.css')) {
            // Serve CSS files from resources directory
            filePath = path.join(this.resourcesPath, pathname.substring(1));
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

    private serveModifiedIndexHtml(filePath: string, listenerPort: string | null, themeMode: string | null, res: http.ServerResponse): void {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[Renderer Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            // Get KaTeX macros from settings
            const katexMacros = getKatexMacrosFromSettings();

            // Build configuration script
            let configScript = '<script>\n';
            
            if (listenerPort) {
                configScript += `        // Listener port configuration\n`;
                configScript += `        window.lutexListenerPort = ${parseInt(listenerPort)};\n`;
            }
            
            if (themeMode) {
                configScript += `        // Theme mode configuration\n`;
                configScript += `        window.lutexDefaultTheme = '${themeMode}';\n`;
            }
            
            // Add KaTeX macros configuration
            configScript += `        // KaTeX macros configuration\n`;
            configScript += `        window.lutexKatexMacros = ${JSON.stringify(katexMacros)};\n`;
            
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
                        this.outputChannel.appendLine(`[Renderer Server] LaTeX renderer server started on port ${this.port}`);
                        this.outputChannel.appendLine(`[Renderer Server] Access at: http://localhost:${this.port}`);
                        resolve(this.port!);
                    }).on('error', (err: NodeJS.ErrnoException) => {
                        this.outputChannel.appendLine(`[Renderer Server] Error starting server on port ${actualPort}: ${err.message}`);
                        reject(err);
                    });
                });
                
                return serverPort;
            } catch (error) {
                if (currentPort) {
                    // Increment port and try again
                    currentPort++;
                    this.outputChannel.appendLine(`[Renderer Server] Retrying with port ${currentPort}...`);
                } else {
                    // Auto-detect mode failed, this shouldn't happen but log it
                    this.outputChannel.appendLine('[Renderer Server] Auto-detect port failed, retrying...');
                }
            }
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
