import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { jumpToLine } from './fileNavigation';
import { findAvailablePort, parseLineNumber, addCorsHeaders, handleOptionsRequest, sendErrorResponse } from './tools';
import { getKatexMacrosFromSettings } from './settings';

export class SdServer {
    private server: http.Server;
    private outputChannel: vscode.OutputChannel;
    private resourcesPath: string;
    private distResourcesPath: string;
    private port: number | null = null;

    constructor(outputChannel: vscode.OutputChannel, extensionPath: string) {
        this.outputChannel = outputChannel;
        this.resourcesPath = path.join(extensionPath, 'res', 'sd');
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
                this.outputChannel.appendLine(`[Slides Server] Method not allowed: ${req.method}`);
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
                this.outputChannel.appendLine(`[Slides Server] Received jump request { file: ${file}, line: ${line} }`);
                
                const lineNumber = parseLineNumber(line, res, this.outputChannel);
                if (lineNumber === null) return;
                
                if (file && typeof file === 'string' && lineNumber > 0) {
                    jumpToLine(file, lineNumber, this.outputChannel);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Success');
                } else {
                    const errorMsg = 'Invalid request format. Expected JSON with file (string) and line (number > 0) properties.';
                    this.outputChannel.appendLine(`[Slides Server] Error: ${errorMsg}`);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(errorMsg);
                }
            } catch (error) {
                const errorMsg = `Error processing HTTP data: ${error}`;
                this.outputChannel.appendLine(`[Slides Server] ${errorMsg}`);
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

        // Serve all files from workspace root
        const workspaceRoot = workspaceFolder.uri.fsPath;
        let fileName = pathname.startsWith('/') ? pathname.substring(1) : pathname;
        
        // Default to index.html for root path
        if (fileName === '') {
            fileName = 'index.html';
        }
        
        const filePath = path.join(workspaceRoot, fileName);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
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
            case '.png':
                contentType = 'image/png';
                break;
            case '.jpg':
            case '.jpeg':
                contentType = 'image/jpeg';
                break;
            case '.gif':
                contentType = 'image/gif';
                break;
            case '.svg':
                contentType = 'image/svg+xml';
                break;
            case '.webp':
                contentType = 'image/webp';
                break;
            case '.ico':
                contentType = 'image/x-icon';
                break;
        }

        // Read and serve the file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[Slides Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    private serveModifiedIndexHtml(filePath: string, markdownFile: string | null, listenerPort: string | null, res: http.ServerResponse): void {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                this.outputChannel.appendLine(`[Slides Server] Error reading file ${filePath}: ${err.message}`);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
                return;
            }

            // Get KaTeX macros from settings
            const katexMacros = getKatexMacrosFromSettings();

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
        // Copy static files to workspace root
        this.copyStaticFiles();
        
        // Write KaTeX macros to workspace for static file server compatibility
        this.writeKatexMacrosFile();
        
        const tryStart = async (): Promise<number> => {
            const actualPort = port || await findAvailablePort();
            
            return new Promise((resolve, reject) => {
                this.server.listen(actualPort, 'localhost', () => {
                    this.port = actualPort;
                    this.outputChannel.appendLine(`[Slides Server] Slides renderer server started on port ${this.port}`);
                    this.outputChannel.appendLine(`[Slides Server] Serving workspace root with listener support`);
                    resolve(this.port!);
                }).on('error', (err: NodeJS.ErrnoException) => {
                    this.outputChannel.appendLine(`[Slides Server] Error starting server on port ${actualPort}: ${err.message}`);
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
                    const errorMsg = `Failed to start slides server on port ${port}: ${error}`;
                    this.outputChannel.appendLine(`[Slides Server] ${errorMsg}`);
                    throw new Error(errorMsg);
                }
                // Otherwise, retry with a new random port
                this.outputChannel.appendLine('[Slides Server] Retrying with a new port...');
            }
        }
    }

    private writeKatexMacrosFile(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const katexMacros = getKatexMacrosFromSettings();
        const distPath = path.join(workspaceFolder.uri.fsPath, 'dist');
        const macrosFilePath = path.join(distPath, 'katexMacros.js');
        
        const content = `// KaTeX macros configuration - auto-generated by Lutex
window.lutexKatexMacros = ${JSON.stringify(katexMacros, null, 2)};
`;
        
        try {
            // Create dist directory if it doesn't exist
            if (!fs.existsSync(distPath)) {
                fs.mkdirSync(distPath, { recursive: true });
            }
            fs.writeFileSync(macrosFilePath, content, 'utf8');
            this.outputChannel.appendLine(`[Slides Server] KaTeX macros written to ${macrosFilePath}`);
        } catch (error) {
            this.outputChannel.appendLine(`[Slides Server] Warning: Could not write katexMacros.js: ${error}`);
        }
    }

    private copyStaticFiles(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        try {
            const targetRoot = workspaceFolder.uri.fsPath;
            const distDir = path.join(targetRoot, 'dist');
            
            // Source files from extension
            const srcIndex = path.join(this.resourcesPath, 'index.html');
            const srcCss = path.join(this.resourcesPath, 'sd.css');
            const srcJs = path.join(this.distResourcesPath, 'sdRenderer.js');
            
            // Destination files in workspace
            const dstIndex = path.join(targetRoot, 'index.html');
            const dstCss = path.join(targetRoot, 'sd.css');
            const dstJs = path.join(distDir, 'sdRenderer.js');

            // Create directories
            if (!fs.existsSync(distDir)) {
                fs.mkdirSync(distDir, { recursive: true });
            }

            // Copy files
            fs.copyFileSync(srcIndex, dstIndex);
            fs.copyFileSync(srcCss, dstCss);
            fs.copyFileSync(srcJs, dstJs);

            this.outputChannel.appendLine(`[Slides Server] Static files copied to workspace root`);
        } catch (error) {
            this.outputChannel.appendLine(`[Slides Server] Warning: Could not copy static files: ${error}`);
        }
    }

    public stop(): void {
        if (this.server) {
            this.outputChannel.appendLine('[Slides Server] Stopping slides renderer server...');
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
