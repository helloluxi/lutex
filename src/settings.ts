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
    const macros = config.get<{ [key: string]: string }>('katexMacros');
    return macros || {};
}

export function getChromePathFromSettings(): string | undefined {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    const chromePath = config.get<string>('chromePath');
    return chromePath && chromePath.trim() !== '' ? chromePath.trim() : undefined;
}

export function getAutoLaunchFromSettings(): string {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    return config.get<string>('autoLaunch') ?? 'none';
}

export function getPdfExportDateFromSettings(): string {
    const config = vscode.workspace.getConfiguration('lutex-ext');
    return config.get<string>('pdfExportDate') ?? '';
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