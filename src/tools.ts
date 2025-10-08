import * as http from 'http';
import * as vscode from 'vscode';

/**
 * Common utility functions for the LuTeX extension
 */

/**
 * Find an available random port between 1024 and 65535
 * @returns Promise<number> - The available port
 */
export function findAvailablePort(): Promise<number> {
    return new Promise((resolve) => {
        const tryPort = () => {
            // Generate a random port between 1024 and 65535
            const port = Math.floor(Math.random() * (65535 - 1024 + 1)) + 1024;
            const testServer = http.createServer();
            
            testServer.listen(port, 'localhost', () => {
                testServer.close(() => {
                    resolve(port);
                });
            }).on('error', () => {
                // On any error, try again with a new random port
                tryPort();
            });
        };
        
        tryPort();
    });
}

/**
 * Parse line number from various input types
 * @param line - The line input (number, string, or other)
 * @param res - HTTP response object for error handling
 * @param outputChannel - Output channel for logging
 * @returns number | null - The parsed line number or null if invalid
 */
export function parseLineNumber(
    line: any, 
    res: http.ServerResponse, 
    outputChannel: vscode.OutputChannel
): number | null {
    let lineNumber: number;
    
    if (typeof line === 'number') {
        lineNumber = line;
    } else if (typeof line === 'string') {
        lineNumber = parseInt(line, 10);
        if (isNaN(lineNumber)) {
            const errorMsg = `Invalid line number: ${line}. Must be a valid number.`;
            outputChannel.appendLine(`[HTTP Server] Error: ${errorMsg}`);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(errorMsg);
            return null;
        }
    } else {
        const errorMsg = `Invalid line type: ${typeof line}. Must be a number or string.`;
        outputChannel.appendLine(`[HTTP Server] Error: ${errorMsg}`);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(errorMsg);
        return null;
    }
    
    return lineNumber;
}

/**
 * Check if main.tex exists in the workspace
 * @returns Promise<boolean> - True if main.tex exists, false otherwise
 */
export async function checkMainTexExists(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found. Please open a folder containing your LaTeX project.');
        return false;
    }

    try {
        const mainTexUri = vscode.Uri.joinPath(workspaceFolder.uri, 'main.tex');
        await vscode.workspace.fs.stat(mainTexUri);
        return true;
    } catch {
        vscode.window.showErrorMessage('main.tex not found in workspace. Please ensure your LaTeX project has a main.tex file.');
        return false;
    }
}

/**
 * Add CORS headers to HTTP response
 * @param res - HTTP response object
 * @param methods - Allowed methods (default: 'GET, POST, OPTIONS')
 */
export function addCorsHeaders(res: http.ServerResponse, methods: string = 'GET, POST, OPTIONS'): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Handle HTTP OPTIONS (preflight) requests
 * @param res - HTTP response object
 */
export function handleOptionsRequest(res: http.ServerResponse): void {
    res.writeHead(204);
    res.end();
}

/**
 * Send error response with logging
 * @param res - HTTP response object
 * @param statusCode - HTTP status code
 * @param message - Error message
 * @param outputChannel - Output channel for logging
 */
export function sendErrorResponse(
    res: http.ServerResponse, 
    statusCode: number, 
    message: string, 
    outputChannel: vscode.OutputChannel
): void {
    outputChannel.appendLine(`[HTTP Server] Error ${statusCode}: ${message}`);
    res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
    res.end(message);
}

