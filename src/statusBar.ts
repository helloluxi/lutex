import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private rendererRunning: boolean = false;
    private listenerRunning: boolean = false;
    private rendererPort: number | null = null;
    private listenerPort: number | null = null;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'lutex-ext.toggleStatus';
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    public setRendererStatus(running: boolean, port: number | null = null): void {
        this.rendererRunning = running;
        this.rendererPort = port;
        this.updateStatusBar();
    }

    public setListenerStatus(running: boolean, port: number | null = null): void {
        this.listenerRunning = running;
        this.listenerPort = port;
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        const rendererIcon = this.rendererRunning ? '$(preview)' : '$(circle-slash)';
        const listenerIcon = this.listenerRunning ? '$(radio-tower)' : '$(circle-slash)';
        
        let text = `${rendererIcon} ${listenerIcon} LuTeX`;
        let tooltip = 'LuTeX Status:\n';
        
        if (this.rendererRunning && this.rendererPort) {
            tooltip += `• Renderer: Running on port ${this.rendererPort}\n`;
        } else {
            tooltip += '• Renderer: Stopped\n';
        }
        
        if (this.listenerRunning && this.listenerPort) {
            tooltip += `• Listener: Running on port ${this.listenerPort}`;
        } else {
            tooltip += '• Listener: Stopped';
        }

        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
}