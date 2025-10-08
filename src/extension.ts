import * as vscode from 'vscode';
import * as path from 'path';
import { registerFileCommands } from './fileCommands';
import { registerBibtexCommands } from './bibtexCommands';
import { ListenerServer } from './listenerServer';
import { RendererServer } from './rendererServer';
import { getRendererPortFromSettings, getListenerPortFromSettings, getThemeFromSettings } from './settings';
import { StatusBarManager } from './statusBar';
import { checkMainTexExists } from './tools';

export function activate(context: vscode.ExtensionContext) {
    // Create a dedicated output channel for LuTeX
    const outputChannel = vscode.window.createOutputChannel('LuTeX');
    outputChannel.appendLine('[LuTeX] Extension is now active!');

    // Register math transformation commands
    registerFileCommands(context, outputChannel);
    
    // Register BibTeX cleaning commands
    registerBibtexCommands(context, outputChannel);

    // Initialize servers
    const listenerServer = new ListenerServer(outputChannel);
    const rendererServer = new RendererServer(outputChannel, context.extensionPath);
    
    // Initialize status bar
    const statusBar = new StatusBarManager();

    // Set up file watcher for .tex files to trigger refresh
    const texFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    texFileWatcher.onDidChange(() => {
        if (listenerServer.isRunning()) {
            listenerServer.notifyRefresh();
        }
    });
    texFileWatcher.onDidCreate(() => {
        if (listenerServer.isRunning()) {
            listenerServer.notifyRefresh();
        }
    });
    texFileWatcher.onDidDelete(() => {
        if (listenerServer.isRunning()) {
            listenerServer.notifyRefresh();
        }
    });
    context.subscriptions.push(texFileWatcher);

    // Register commands
    
    // Launch Renderer
    const launchRendererCommand = vscode.commands.registerCommand('lutex-ext.launchRenderer', async () => {
        try {
            if (rendererServer.isRunning()) {
                const port = rendererServer.getPort();
                outputChannel.appendLine(`[LuTeX] Renderer already running on port ${port}, opening browser`);
                
                // Build URL with parameters
                let url = `http://localhost:${port}`;
                const params = new URLSearchParams();
                
                if (listenerServer.isRunning()) {
                    const listenerPort = listenerServer.getPort();
                    params.append('o', listenerPort!.toString());
                }
                
                const theme = getThemeFromSettings();
                params.append('m', theme);
                
                const queryString = params.toString();
                if (queryString) {
                    url += `?${queryString}`;
                }
                
                vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }

            if (!(await checkMainTexExists())) return;

            const configuredPort = getRendererPortFromSettings();
            const port = configuredPort > 0 ? configuredPort : undefined;
            const serverPort = await rendererServer.start(port);
            
            statusBar.setRendererStatus(true, serverPort);
            
            // Build URL with parameters
            let url = `http://localhost:${serverPort}`;
            const params = new URLSearchParams();
            
            if (listenerServer.isRunning()) {
                const listenerPort = listenerServer.getPort();
                params.append('o', listenerPort!.toString());
            }
            
            const theme = getThemeFromSettings();
            params.append('m', theme);
            
            const queryString = params.toString();
            if (queryString) {
                url += `?${queryString}`;
            }
            
            // Automatically open browser
            vscode.env.openExternal(vscode.Uri.parse(url));
            outputChannel.appendLine(`[LuTeX] Renderer started on port ${serverPort}, opened in browser`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start LaTeX renderer: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Activate renderer error: ${errorMessage}`);
        }
    });

    // Close Renderer
    const closeRendererCommand = vscode.commands.registerCommand('lutex-ext.closeRenderer', () => {
        if (rendererServer.isRunning()) {
            rendererServer.stop();
            statusBar.setRendererStatus(false);
            outputChannel.appendLine('[LuTeX] Renderer stopped');
        } else {
            outputChannel.appendLine('[LuTeX] Renderer not running');
        }
    });

    // Launch Listener
    const launchListenerCommand = vscode.commands.registerCommand('lutex-ext.launchListener', async () => {
        try {
            if (listenerServer.isRunning()) {
                const port = listenerServer.getPort();
                outputChannel.appendLine(`[LuTeX] Listener already running on port ${port}`);
                return;
            }

            const configuredPort = getListenerPortFromSettings();
            const port = configuredPort > 0 ? configuredPort : undefined;
            const serverPort = await listenerServer.start(port);
            
            statusBar.setListenerStatus(true, serverPort);
            outputChannel.appendLine(`[LuTeX] Listener started on port ${serverPort}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start line jumping listener: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Activate listener error: ${errorMessage}`);
        }
    });

    // Close Listener
    const closeListenerCommand = vscode.commands.registerCommand('lutex-ext.closeListener', () => {
        if (listenerServer.isRunning()) {
            listenerServer.stop();
            statusBar.setListenerStatus(false);
            outputChannel.appendLine('[LuTeX] Listener stopped');
        } else {
            outputChannel.appendLine('[LuTeX] Listener not running');
        }
    });

    // Launch Both
    const launchCommand = vscode.commands.registerCommand('lutex-ext.launch', async () => {
        try {
            // Start listener first
            if (!listenerServer.isRunning()) {
                const configuredListenerPort = getListenerPortFromSettings();
                const listenerPort = configuredListenerPort > 0 ? configuredListenerPort : undefined;
                const listenerServerPort = await listenerServer.start(listenerPort);
                statusBar.setListenerStatus(true, listenerServerPort);
                outputChannel.appendLine(`[LuTeX] Listener started on port ${listenerServerPort}`);
            }

            // Then start renderer (which will automatically include listener param)
            if (!rendererServer.isRunning()) {
                if (!(await checkMainTexExists())) return;

                const configuredRendererPort = getRendererPortFromSettings();
                const rendererPort = configuredRendererPort > 0 ? configuredRendererPort : undefined;
                const rendererServerPort = await rendererServer.start(rendererPort);
                statusBar.setRendererStatus(true, rendererServerPort);

                // Build URL with parameters
                let url = `http://localhost:${rendererServerPort}`;
                const params = new URLSearchParams();
                
                if (listenerServer.isRunning()) {
                    const listenerPort = listenerServer.getPort();
                    params.append('o', listenerPort!.toString());
                }
                
                const theme = getThemeFromSettings();
                params.append('m', theme);
                
                const queryString = params.toString();
                if (queryString) {
                    url += `?${queryString}`;
                }

                // Automatically open browser
                vscode.env.openExternal(vscode.Uri.parse(url));
                outputChannel.appendLine(`[LuTeX] Both services started - renderer: ${rendererServerPort}, listener: ${listenerServer.getPort()}, opened in browser`);
            } else {
                // If renderer is already running, just ensure browser opens with parameters
                const rendererPort = rendererServer.getPort();
                let url = `http://localhost:${rendererPort}`;
                const params = new URLSearchParams();
                
                if (listenerServer.isRunning()) {
                    const listenerPort = listenerServer.getPort();
                    params.append('o', listenerPort!.toString());
                }
                
                const theme = getThemeFromSettings();
                params.append('m', theme);
                
                const queryString = params.toString();
                if (queryString) {
                    url += `?${queryString}`;
                }
                
                vscode.env.openExternal(vscode.Uri.parse(url));
                outputChannel.appendLine(`[LuTeX] Renderer already running, opened with listener integration`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start services: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Launch both error: ${errorMessage}`);
        }
    });

    // Close Both  
    const closeCommand = vscode.commands.registerCommand('lutex-ext.close', () => {
        vscode.commands.executeCommand('lutex-ext.closeRenderer');
        vscode.commands.executeCommand('lutex-ext.closeListener');
    });

    // Jump to HTML element based on current cursor position
    const jumpToHtmlCommand = vscode.commands.registerCommand('lutex-ext.jumpToHtml', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            outputChannel.appendLine('[LuTeX] No active editor');
            return;
        }

        if (!listenerServer.isRunning()) {
            outputChannel.appendLine('[LuTeX] Listener server not running');
            vscode.window.showWarningMessage('Listener server is not running. Please start it first.');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const lineNumber = position.line + 1;
        const fileName = path.relative(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', document.fileName);

        outputChannel.appendLine(`[LuTeX] Sending scroll request for ${fileName}:${lineNumber}`);
        listenerServer.notifyScroll(fileName, lineNumber);
    });

    // Status bar toggle command
    const toggleStatusCommand = vscode.commands.registerCommand('lutex-ext.toggleStatus', async () => {
        const options: string[] = [];
        
        if (rendererServer.isRunning()) {
            options.push('Stop Renderer');
        } else {
            options.push('Start Renderer');
        }
        
        if (listenerServer.isRunning()) {
            options.push('Stop Listener');
        } else {
            options.push('Start Listener');
        }
        
        options.push('Start Both', 'Stop Both');

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'Choose action'
        });

        switch (selection) {
            case 'Start Renderer':
                await vscode.commands.executeCommand('lutex-ext.launchRenderer');
                break;
            case 'Stop Renderer':
                await vscode.commands.executeCommand('lutex-ext.closeRenderer');
                break;
            case 'Start Listener':
                await vscode.commands.executeCommand('lutex-ext.launchListener');
                break;
            case 'Stop Listener':
                await vscode.commands.executeCommand('lutex-ext.closeListener');
                break;
            case 'Start Both':
                await vscode.commands.executeCommand('lutex-ext.launch');
                break;
            case 'Stop Both':
                await vscode.commands.executeCommand('lutex-ext.close');
                break;
        }
    });

    // Register all commands
    context.subscriptions.push(
        launchRendererCommand,
        closeRendererCommand,
        launchListenerCommand,
        closeListenerCommand,
        launchCommand,
        closeCommand,
        jumpToHtmlCommand,
        toggleStatusCommand,
        statusBar
    );

    // Clean up when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            listenerServer.stop();
            rendererServer.stop();
            outputChannel.dispose();
        }
    });
}

export function deactivate() {} 