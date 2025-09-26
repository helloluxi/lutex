import * as vscode from 'vscode';

export function getPortFromSettings(): number | null {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    const port = config.get<number>('port');
    return port || null;
}