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

export function getKatexMacrosFromSettings(): { [key: string]: string } {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    const defaultMacros = {
        "\\ket": "\\lvert #1 \\rangle",
        "\\bra": "\\langle #1 \\rvert",
        "\\ip": "\\langle #1 | #2 \\rangle",
        "\\dyad": "\\ket{#1} \\bra{#2}"
    };
    return config.get<{ [key: string]: string }>('katexMacros') ?? defaultMacros;
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