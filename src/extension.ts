import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    // Create a dedicated output channel for LuTeX
    const outputChannel = vscode.window.createOutputChannel('LuTeX');
    outputChannel.appendLine('[LuTeX] Extension is now active!');

    // Function to handle line jumping
    const jumpToLine = (fileName: string, lineNumber: number) => {
        // Look for the specific file starting from workspace root
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            const errorMsg = 'No workspace folder found';
            outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
            console.log(errorMsg);
            return;
        }
        
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const fullPath = path.join(workspaceRoot, fileName);
        
        // Check if the file exists at the specified path
        if (fs.existsSync(fullPath)) {
            const fileUri = vscode.Uri.file(fullPath);
            vscode.workspace.openTextDocument(fileUri).then((document) => {
                vscode.window.showTextDocument(document).then((editor) => {
                    const position = new vscode.Position(lineNumber - 1, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(
                        new vscode.Range(position, position),
                        vscode.TextEditorRevealType.InCenter
                    );
                });
            });
        } else {
            const errorMsg = `Could not find file: ${fullPath}`;
            outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
            console.log(errorMsg);
        }
    };

    // Function to read port from VS Code configuration
    const getPortFromSettings = (): number | null => {
        const config = vscode.workspace.getConfiguration('lutex-ext');
        const port = config.get<number>('port');
        return port || null;
    };

    // Create an HTTP server
    const httpServer = http.createServer((req, res) => {
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
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const { file, line } = data;
                    outputChannel.appendLine(`[LuTeX] Received { file: ${file}, line: ${line} }`);
                    
                    // Convert line to number if it's a string
                    let lineNumber: number;
                    if (typeof line === 'number') {
                        lineNumber = line;
                    } else if (typeof line === 'string') {
                        lineNumber = parseInt(line, 10);
                        if (isNaN(lineNumber)) {
                            const errorMsg = `Invalid line number: ${line}. Must be a valid number.`;
                            outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
                            res.writeHead(400, { 'Content-Type': 'text/plain' });
                            res.end(errorMsg);
                            return;
                        }
                    } else {
                        const errorMsg = `Invalid line type: ${typeof line}. Must be a number or string.`;
                        outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end(errorMsg);
                        return;
                    }
                    
                    if (file && typeof file === 'string' && lineNumber > 0) {
                        jumpToLine(file, lineNumber);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Success');
                    } else {
                        const errorMsg = 'Invalid request format. Expected JSON with file (string) and line (number > 0) properties.';
                        outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end(errorMsg);
                    }
                } catch (error) {
                    const errorMsg = `Error processing HTTP data: ${error}`;
                    outputChannel.appendLine(`[LuTeX] ${errorMsg}`);
                    console.error(errorMsg);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal server error');
                }
            });
        } else {
            outputChannel.appendLine(`[LuTeX] Method not allowed: ${req.method}`);
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method not allowed');
        }
    });

    // Check if port is configured in settings and start server if it is
    const port = getPortFromSettings();
    
    if (port && port !== 1024) {
        // Try to start the server
        httpServer.listen(port, 'localhost', () => {
            outputChannel.appendLine(`[LuTeX] HttpServer started on port ${port}`);
        }).on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                const errorMsg = `Port ${port} is already in use. Server not started.`;
                outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
                console.error(errorMsg);
            } else {
                const errorMsg = `Error starting server: ${err}`;
                outputChannel.appendLine(`[LuTeX] Error: ${errorMsg}`);
                console.error(errorMsg);
            }
        });
    } else {
        const msg = 'No port configured in settings. Server not started.';
        outputChannel.appendLine(`[LuTeX] ${msg}`);
        console.log(msg);
    }

    // Clean up when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            outputChannel.appendLine('[LuTeX] Extension deactivating, closing HTTP server...');
            httpServer.close();
            outputChannel.dispose();
        }
    });
}

export function deactivate() {} 