import * as vscode from 'vscode';
import { registerMathCommands } from './mathCommands';
import { registerBibtexCommands } from './bibtexCommands';
import { HttpServerManager } from './httpServer';
import { getPortFromSettings } from './settings';

export function activate(context: vscode.ExtensionContext) {
    // Create a dedicated output channel for LuTeX
    const outputChannel = vscode.window.createOutputChannel('LuTeX');
    outputChannel.appendLine('[LuTeX] Extension is now active!');

    // Register math transformation commands
    registerMathCommands(context, outputChannel);
    
    // Register BibTeX cleaning commands
    registerBibtexCommands(context, outputChannel);

    // Initialize HTTP server for line jumping functionality
    const httpServerManager = new HttpServerManager(outputChannel);

    // Check if port is configured in settings and start server if it is
    const port = getPortFromSettings();
    
    if (port && port !== 1024) {
        httpServerManager.start(port);
    } else {
        const msg = 'No port configured in settings. Server not started.';
        outputChannel.appendLine(`[LuTeX] ${msg}`);
        console.log(msg);
    }

    // Clean up when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            httpServerManager.stop();
            outputChannel.dispose();
        }
    });
}

export function deactivate() {} 