import * as vscode from 'vscode';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private texRendererRunning: boolean = false;
    private mdRendererRunning: boolean = false;
    private listenerRunning: boolean = false;
    private texRendererPort: number | null = null;
    private mdRendererPort: number | null = null;
    private listenerPort: number | null = null;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'lutex-ext.showStatus';
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    public setTexRendererStatus(running: boolean, port: number | null = null): void {
        this.texRendererRunning = running;
        this.texRendererPort = port;
        this.updateStatusBar();
    }

    public setMdRendererStatus(running: boolean, port: number | null = null): void {
        this.mdRendererRunning = running;
        this.mdRendererPort = port;
        this.updateStatusBar();
    }

    public setListenerStatus(running: boolean, port: number | null = null): void {
        this.listenerRunning = running;
        this.listenerPort = port;
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        const icons: string[] = [];
        
        // Add icons based on running services
        if (this.texRendererRunning) {
            icons.push('$(file-code)'); // LaTeX/LuTeX icon
        }
        if (this.mdRendererRunning) {
            icons.push('$(markdown)'); // Markdown icon
        }
        if (this.listenerRunning) {
            icons.push('$(radio-tower)'); // Listener icon
        }
        
        // If nothing is running, show inactive icon
        if (icons.length === 0) {
            icons.push('$(circle-slash)');
        }
        
        const text = `${icons.join(' ')} LuTeX`;
        let tooltip = 'LuTeX Status (click for options):\n';
        
        if (this.texRendererRunning && this.texRendererPort) {
            tooltip += `• LuTeX Renderer: Running on port ${this.texRendererPort}\n`;
        } else {
            tooltip += '• LuTeX Renderer: Stopped\n';
        }
        
        if (this.mdRendererRunning && this.mdRendererPort) {
            tooltip += `• Markdown Renderer: Running on port ${this.mdRendererPort}\n`;
        } else {
            tooltip += '• Markdown Renderer: Stopped\n';
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