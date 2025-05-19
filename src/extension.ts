import * as vscode from 'vscode';
import * as http from 'http';

export function activate(context: vscode.ExtensionContext) {
    console.log('LuTeX Line Jumper is now active!');

    // Function to handle line jumping
    const jumpToLine = (lineNumber: number) => {
        vscode.workspace.findFiles('**/main.tex').then((files) => {
            if (files.length > 0) {
                const mainTexPath = files[0];
                vscode.workspace.openTextDocument(mainTexPath).then((document) => {
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
            //     vscode.window.showErrorMessage('Could not find main.tex in the workspace');
            // }
        });
    };

    // Create an HTTP server
    const httpServer = http.createServer((req, res) => {
        // Add CORS headers
        res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5500');
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

    // Check if main.tex exists and start server if it does
    vscode.workspace.findFiles('**/main.tex').then((files) => {
        if (files.length > 0) {
            // Try to start the server
            httpServer.listen(4999, 'localhost', () => {
                console.log('HTTP Server listening on port 4999');
            }).on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    console.error('Port 4999 is already in use. Server not started.');
                } else {
                    console.error('Error starting server:', err);
                }
            });
        } else {
            console.log('No main.tex found in workspace. Server not started.');
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