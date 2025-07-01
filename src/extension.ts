import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('[LuTeX] Extension is now active!');

    // Function to handle line jumping
    const jumpToLine = (lineNumber: number) => {
        // Look for both main.tex and main.md files
        Promise.all([
            vscode.workspace.findFiles('**/main.tex'),
            vscode.workspace.findFiles('**/main.md')
        ]).then((results) => {
            const texFiles = results[0];
            const mdFiles = results[1];
            const allFiles = [...texFiles, ...mdFiles];
            
            if (allFiles.length > 0) {
                // Prefer main.tex if both exist, otherwise use the first found
                const mainFile = texFiles.length > 0 ? texFiles[0] : allFiles[0];
                vscode.workspace.openTextDocument(mainFile).then((document) => {
                    vscode.window.showTextDocument(document).then((editor) => {
                        const position = new vscode.Position(lineNumber - 1, 0);
                        editor.selection = new vscode.Selection(position, position);
                        editor.revealRange(
                            new vscode.Range(position, position),
                            vscode.TextEditorRevealType.InCenter
                        );
                    });
                });
            }
            // else {
            //     vscode.window.showErrorMessage('Could not find main.tex or main.md in the workspace');
            // }
        });
    };

    // Function to read port from config file
    const getPortFromConfig = (): number => {
        const defaultPort = 4999;
        
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return defaultPort;
        }
        
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const configPath = path.join(workspaceRoot, '.vscode', 'config.json');
        
        try {
            if (fs.existsSync(configPath)) {
                const configContent = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(configContent);
                return config.port || defaultPort;
            }
        } catch (error) {
            console.log('Error reading config file, using default port:', error);
        }
        
        return defaultPort;
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
                    const lineNumber = parseInt(body.trim());
                    if (!isNaN(lineNumber)) {
                        jumpToLine(lineNumber);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Success');
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('Invalid line number');
                    }
                } catch (error) {
                    console.error('Error processing HTTP data:', error);
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal server error');
                }
            });
        } else {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method not allowed');
        }
    });

    // Check if main.tex or main.md exists and start server if either does
    Promise.all([
        vscode.workspace.findFiles('**/main.tex'),
        vscode.workspace.findFiles('**/main.md')
    ]).then((results) => {
        const texFiles = results[0];
        const mdFiles = results[1];
        const allFiles = [...texFiles, ...mdFiles];
        
        if (allFiles.length > 0) {
            const port = getPortFromConfig();
            // Try to start the server
            httpServer.listen(port, 'localhost', () => {
                console.log(`HTTP Server listening on port ${port}`);
            }).on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.error(`Port ${port} is already in use. Server not started.`);
                } else {
                    console.error('Error starting server:', err);
                }
            });
        } else {
            console.log('No main.tex or main.md found in workspace. Server not started.');
        }
    });

    // Clean up when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            httpServer.close();
        }
    });
}

export function deactivate() {} 