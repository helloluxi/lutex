import * as vscode from 'vscode';

export function getRendererPortFromSettings(): number {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    return config.get<number>('rendererPort') ?? 0;
}

export function getListenerPortFromSettings(): number {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    return config.get<number>('listenerPort') ?? 0;
}

export function getThemeFromSettings(): string {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    return config.get<string>('theme') ?? 'dark';
}

// Backward compatibility
export function getPortFromSettings(): number | undefined {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    const oldPort = config.get<number>('port');
    if (oldPort && oldPort !== 1024) {
        return oldPort;
    }
    return undefined;
}