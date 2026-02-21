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

export function toggleCheckbox(fileName: string, lineNumber: number, outputChannel: vscode.OutputChannel): void {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        const errorMsg = 'No workspace folder found';
        outputChannel.appendLine(`[File Navigation] Error: ${errorMsg}`);
        return;
    }
    
    const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const fullPath = path.join(workspaceRoot, fileName);
    
    if (fs.existsSync(fullPath)) {
        const fileUri = vscode.Uri.file(fullPath);
        outputChannel.appendLine(`[File Navigation] Toggling checkbox in: ${fileName} at line ${lineNumber}`);
        vscode.workspace.openTextDocument(fileUri).then((document) => {
            const line = document.lineAt(lineNumber - 1);
            const lineText = line.text;
            
            // Toggle checkbox: [ ] <-> [x]
            let newText = lineText;
            if (lineText.includes('[ ]')) {
                newText = lineText.replace('[ ]', '[x]');
            } else if (lineText.includes('[x]')) {
                newText = lineText.replace('[x]', '[ ]');
            } else {
                outputChannel.appendLine(`[File Navigation] No checkbox found at line ${lineNumber}`);
                return;
            }
            
            const edit = new vscode.WorkspaceEdit();
            edit.replace(fileUri, line.range, newText);
            vscode.workspace.applyEdit(edit).then(() => {
                document.save();
                outputChannel.appendLine(`[File Navigation] Successfully toggled checkbox at ${fileName}:${lineNumber}`);
            });
        });
    } else {
        const errorMsg = `Could not find file: ${fullPath}`;
        outputChannel.appendLine(`[File Navigation] Error: ${errorMsg}`);
    }
}