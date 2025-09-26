import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function jumpToLine(fileName: string, lineNumber: number, outputChannel: vscode.OutputChannel): void {
    // Look for the specific file starting from workspace root
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        const errorMsg = 'No workspace folder found';
        outputChannel.appendLine(`[File Navigation] Error: ${errorMsg}`);
        vscode.window.showErrorMessage(errorMsg);
        return;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const fullPath = path.join(workspaceRoot, fileName);
    
    // Check if the file exists at the specified path
    if (fs.existsSync(fullPath)) {
        const fileUri = vscode.Uri.file(fullPath);
        outputChannel.appendLine(`[File Navigation] Opening file: ${fileName} at line ${lineNumber}`);
        vscode.workspace.openTextDocument(fileUri).then((document) => {
            vscode.window.showTextDocument(document).then((editor) => {
                const position = new vscode.Position(lineNumber - 1, 0);
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                );
                outputChannel.appendLine(`[File Navigation] Successfully navigated to ${fileName}:${lineNumber}`);
            });
        });
    } else {
        const errorMsg = `Could not find file: ${fullPath}`;
        outputChannel.appendLine(`[File Navigation] Error: ${errorMsg}`);
        vscode.window.showErrorMessage(errorMsg);
    }
}