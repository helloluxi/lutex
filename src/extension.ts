import * as vscode from 'vscode';
import * as path from 'path';
import { registerFileCommands } from './fileCommands';
import { registerBibtexCommands } from './bibtexCommands';
import { ListenerServer } from './listenerServer';
import { TexRendererServer } from './texRendererServer';
import { MdRendererServer } from './mdRendererServer';
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
    const texRendererServer = new TexRendererServer(outputChannel, context.extensionPath);
    const mdRendererServer = new MdRendererServer(outputChannel, context.extensionPath);
    
    // Initialize status bar
    const statusBar = new StatusBarManager();

    // Initialize context keys for renderer states
    vscode.commands.executeCommand('setContext', 'lutexRendererActive', false);
    vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', false);

    // Set up file watchers to trigger refresh
    const texFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    texFileWatcher.onDidChange(() => {
        if (listenerServer.isRunning() && texRendererServer.isRunning()) {
            listenerServer.notifyRefresh();
        }
    });
    
    const mdFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    mdFileWatcher.onDidChange(() => {
        if (listenerServer.isRunning() && mdRendererServer.isRunning()) {
            listenerServer.notifyRefresh();
        }
    });
    
    context.subscriptions.push(texFileWatcher, mdFileWatcher);

    // Register commands
    
    // Launch LuTeX Renderer with Listener
    const launchLutexWithListenerCommand = vscode.commands.registerCommand('lutex-ext.launchLutexWithListener', async () => {
        try {
            // Start listener first if not already running
            if (!listenerServer.isRunning()) {
                const configuredListenerPort = getListenerPortFromSettings();
                const listenerPort = configuredListenerPort > 0 ? configuredListenerPort : undefined;
                const listenerServerPort = await listenerServer.start(listenerPort);
                statusBar.setListenerStatus(true, listenerServerPort);
                outputChannel.appendLine(`[LuTeX] Listener started on port ${listenerServerPort}`);
            }

            // Check if renderer is already running
            if (texRendererServer.isRunning()) {
                const port = texRendererServer.getPort();
                outputChannel.appendLine(`[LuTeX] LuTeX renderer already running on port ${port}, opening browser`);
                
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

            // Check for main.tex
            if (!(await checkMainTexExists())) return;

            // Start LuTeX renderer
            const configuredPort = getRendererPortFromSettings();
            const port = configuredPort > 0 ? configuredPort : undefined;
            const serverPort = await texRendererServer.start(port);
            
            vscode.commands.executeCommand('setContext', 'lutexRendererActive', true);
            statusBar.setTexRendererStatus(true, serverPort);
            
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
            outputChannel.appendLine(`[LuTeX] LuTeX renderer started on port ${serverPort} with listener integration`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start LuTeX renderer: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Launch LuTeX renderer error: ${errorMessage}`);
        }
    });

    // Launch Markdown Renderer with Listener
    const launchMarkdownWithListenerCommand = vscode.commands.registerCommand('lutex-ext.launchMarkdownWithListener', async () => {
        try {
            // Get the active markdown file
            const editor = vscode.window.activeTextEditor;
            let markdownFileName = 'main.md'; // default
            
            if (editor && editor.document.languageId === 'markdown') {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const relativePath = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
                    markdownFileName = relativePath.replace(/\\/g, '/'); // Use forward slashes for URL
                }
            }

            // Start listener first if not already running
            if (!listenerServer.isRunning()) {
                const configuredListenerPort = getListenerPortFromSettings();
                const listenerPort = configuredListenerPort > 0 ? configuredListenerPort : undefined;
                const listenerServerPort = await listenerServer.start(listenerPort);
                statusBar.setListenerStatus(true, listenerServerPort);
                outputChannel.appendLine(`[LuTeX] Listener started on port ${listenerServerPort}`);
            }

            // Check if markdown renderer is already running
            if (mdRendererServer.isRunning()) {
                const port = mdRendererServer.getPort();
                outputChannel.appendLine(`[LuTeX] Markdown renderer already running on port ${port}, opening browser`);
                
                // Build URL with parameters
                let url = `http://localhost:${port}`;
                const params = new URLSearchParams();
                
                // Add markdown file parameter
                params.append('f', markdownFileName);
                
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

            // Start markdown renderer
            const configuredPort = getRendererPortFromSettings();
            const port = configuredPort > 0 ? configuredPort : undefined;
            const serverPort = await mdRendererServer.start(port);
            
            vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', true);
            statusBar.setMdRendererStatus(true, serverPort);
            
            // Build URL with parameters
            let url = `http://localhost:${serverPort}`;
            const params = new URLSearchParams();
            
            // Add markdown file parameter
            params.append('f', markdownFileName);
            
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
            outputChannel.appendLine(`[LuTeX] Markdown renderer started on port ${serverPort} with listener integration (file: ${markdownFileName})`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start Markdown renderer: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Launch Markdown renderer error: ${errorMessage}`);
        }
    });

    // Launch Listener Only
    const launchListenerCommand = vscode.commands.registerCommand('lutex-ext.launchListener', async () => {
        try {
            if (listenerServer.isRunning()) {
                const port = listenerServer.getPort();
                outputChannel.appendLine(`[LuTeX] Listener already running on port ${port}`);
                vscode.window.showInformationMessage(`Listener already running on port ${port}`);
                return;
            }

            const configuredPort = getListenerPortFromSettings();
            const port = configuredPort > 0 ? configuredPort : undefined;
            const serverPort = await listenerServer.start(port);
            
            statusBar.setListenerStatus(true, serverPort);
            outputChannel.appendLine(`[LuTeX] Listener started on port ${serverPort}`);
            vscode.window.showInformationMessage(`Listener started on port ${serverPort}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start listener: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Launch listener error: ${errorMessage}`);
        }
    });

    // Close All
    const closeAllCommand = vscode.commands.registerCommand('lutex-ext.closeAll', () => {
        let stopped: string[] = [];
        
        if (texRendererServer.isRunning()) {
            texRendererServer.stop();
            vscode.commands.executeCommand('setContext', 'lutexRendererActive', false);
            statusBar.setTexRendererStatus(false);
            stopped.push('LuTeX renderer');
            outputChannel.appendLine('[LuTeX] LuTeX renderer stopped');
        }
        
        if (mdRendererServer.isRunning()) {
            mdRendererServer.stop();
            vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', false);
            statusBar.setMdRendererStatus(false);
            stopped.push('Markdown renderer');
            outputChannel.appendLine('[LuTeX] Markdown renderer stopped');
        }
        
        if (listenerServer.isRunning()) {
            listenerServer.stop();
            statusBar.setListenerStatus(false);
            stopped.push('Listener');
            outputChannel.appendLine('[LuTeX] Listener stopped');
        }
        
        if (stopped.length > 0) {
            outputChannel.appendLine(`[LuTeX] Stopped: ${stopped.join(', ')}`);
        } else {
            outputChannel.appendLine('[LuTeX] No services were running');
        }
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

    // Status bar click command - show quick pick menu
    const showStatusCommand = vscode.commands.registerCommand('lutex-ext.showStatus', async () => {
        const options: vscode.QuickPickItem[] = [];
        
        // Add options based on current state
        if (!texRendererServer.isRunning()) {
            options.push({
                label: '$(play) Launch LuTeX Renderer with Listener',
                description: 'Start LuTeX (LaTeX) renderer and listener',
                detail: 'Opens a browser with the LaTeX renderer'
            });
        } else {
            options.push({
                label: '$(debug-stop) Stop LuTeX Renderer',
                description: `Currently running on port ${texRendererServer.getPort()}`,
                detail: 'Stop the LaTeX renderer'
            });
        }
        
        if (!mdRendererServer.isRunning()) {
            options.push({
                label: '$(play) Launch Markdown Renderer with Listener',
                description: 'Start Markdown renderer and listener',
                detail: 'Opens a browser with the Markdown renderer'
            });
        } else {
            options.push({
                label: '$(debug-stop) Stop Markdown Renderer',
                description: `Currently running on port ${mdRendererServer.getPort()}`,
                detail: 'Stop the Markdown renderer'
            });
        }
        
        if (!listenerServer.isRunning()) {
            options.push({
                label: '$(radio-tower) Launch Listener Only',
                description: 'Start listener without renderer',
                detail: 'For two-way communication with external renderers'
            });
        } else {
            options.push({
                label: '$(debug-stop) Stop Listener',
                description: `Currently running on port ${listenerServer.getPort()}`,
                detail: 'Stop the listener'
            });
        }
        
        // Always show close all if anything is running
        if (texRendererServer.isRunning() || mdRendererServer.isRunning() || listenerServer.isRunning()) {
            options.push({
                label: '$(trash) Close All',
                description: 'Stop all running services',
                detail: 'Stop renderers and listener'
            });
        }

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select LuTeX action',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selection) return;

        // Execute based on selection
        if (selection.label.includes('LuTeX Renderer with Listener')) {
            await vscode.commands.executeCommand('lutex-ext.launchLutexWithListener');
        } else if (selection.label.includes('Markdown Renderer with Listener')) {
            await vscode.commands.executeCommand('lutex-ext.launchMarkdownWithListener');
        } else if (selection.label.includes('Listener Only')) {
            await vscode.commands.executeCommand('lutex-ext.launchListener');
        } else if (selection.label.includes('Stop LuTeX Renderer')) {
            if (texRendererServer.isRunning()) {
                texRendererServer.stop();
                vscode.commands.executeCommand('setContext', 'lutexRendererActive', false);
                statusBar.setTexRendererStatus(false);
                outputChannel.appendLine('[LuTeX] LuTeX renderer stopped');
            }
        } else if (selection.label.includes('Stop Markdown Renderer')) {
            if (mdRendererServer.isRunning()) {
                mdRendererServer.stop();
                vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', false);
                statusBar.setMdRendererStatus(false);
                outputChannel.appendLine('[LuTeX] Markdown renderer stopped');
            }
        } else if (selection.label.includes('Stop Listener')) {
            if (listenerServer.isRunning()) {
                listenerServer.stop();
                statusBar.setListenerStatus(false);
                outputChannel.appendLine('[LuTeX] Listener stopped');
            }
        } else if (selection.label.includes('Close All')) {
            await vscode.commands.executeCommand('lutex-ext.closeAll');
        }
    });

    // Register all commands
    context.subscriptions.push(
        launchLutexWithListenerCommand,
        launchMarkdownWithListenerCommand,
        launchListenerCommand,
        closeAllCommand,
        jumpToHtmlCommand,
        showStatusCommand,
        statusBar
    );

    // Clean up when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            listenerServer.stop();
            texRendererServer.stop();
            mdRendererServer.stop();
            vscode.commands.executeCommand('setContext', 'lutexRendererActive', false);
            vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', false);
            outputChannel.dispose();
        }
    });
}

export function deactivate() {} 
