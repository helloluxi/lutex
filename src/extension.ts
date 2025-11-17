import * as vscode from 'vscode';
import * as path from 'path';
import { registerFileCommands } from './fileCommands';
import { registerBibtexCommands } from './bibtexCommands';
import { ListenerServer } from './listenerServer';
import { TexServer } from './texServer';
import { MdServer } from './mdServer';
import { SdServer } from './sdServer';
import { getRendererPortFromSettings, getListenerPortFromSettings, getThemeFromSettings, getChromePathFromSettings, getAutoLaunchFromSettings } from './settings';
import { StatusBarManager } from './statusBar';
import { checkMainTexExists } from './tools';
import { generateSlidePDF } from './slidesToPdf';

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
    const texRendererServer = new TexServer(outputChannel, context.extensionPath);
    const mdRendererServer = new MdServer(outputChannel, context.extensionPath);
    const slidesRendererServer = new SdServer(outputChannel, context.extensionPath);
    
    // Initialize status bar
    const statusBar = new StatusBarManager();

    // Initialize context keys for renderer states
    vscode.commands.executeCommand('setContext', 'lutexRendererActive', false);
    vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', false);
    vscode.commands.executeCommand('setContext', 'lutexSlidesRendererActive', false);

    // Set up file watchers to trigger refresh
    const texFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    texFileWatcher.onDidChange(() => {
        if (listenerServer.isRunning() && texRendererServer.isRunning()) {
            listenerServer.notifyRefresh();
        }
    });
    
    const mdFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    mdFileWatcher.onDidChange(() => {
        if (listenerServer.isRunning() && (mdRendererServer.isRunning() || slidesRendererServer.isRunning())) {
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

    // Launch Slides Renderer with Listener
    const launchSlidesWithListenerCommand = vscode.commands.registerCommand('lutex-ext.launchSlidesWithListener', async () => {
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

            // Always scaffold a static slides site into workspace ROOT for optional static hosting
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                try {
                    const targetRoot = workspaceFolder.uri.fsPath; // root
                    const distDir = path.join(targetRoot, 'dist');
                    const srcIndex = path.join(context.extensionPath, 'res', 'sd', 'index.html');
                    const srcCss = path.join(context.extensionPath, 'res', 'sd', 'sd.css');
                    const srcJs = path.join(context.extensionPath, 'res', 'dist', 'sdRenderer.js');

                    const dstIndex = path.join(targetRoot, 'index.html');
                    const dstCss = path.join(targetRoot, 'sd.css');
                    const dstJs = path.join(distDir, 'sdRenderer.js');

                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetRoot));
                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(distDir));
                    await vscode.workspace.fs.copy(vscode.Uri.file(srcIndex), vscode.Uri.file(dstIndex), { overwrite: true } as any);
                    await vscode.workspace.fs.copy(vscode.Uri.file(srcCss), vscode.Uri.file(dstCss), { overwrite: true } as any);
                    await vscode.workspace.fs.copy(vscode.Uri.file(srcJs), vscode.Uri.file(dstJs), { overwrite: true } as any);

                    outputChannel.appendLine(`[LuTeX] Slides static scaffold refreshed at workspace root: ${targetRoot}`);
                } catch (scaffoldErr) {
                    const errMsg = scaffoldErr instanceof Error ? scaffoldErr.message : String(scaffoldErr);
                    outputChannel.appendLine(`[LuTeX] Warning: Unable to scaffold static slides: ${errMsg}`);
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

            // Check if slides renderer is already running
            if (slidesRendererServer.isRunning()) {
                const port = slidesRendererServer.getPort();
                outputChannel.appendLine(`[LuTeX] Slides renderer already running on port ${port}, opening browser`);
                
                // Build URL with parameters
                let url = `http://localhost:${port}`;
                const params = new URLSearchParams();
                
                // Add markdown file parameter
                params.append('f', markdownFileName || 'main.md');
                
                if (listenerServer.isRunning()) {
                    const listenerPort = listenerServer.getPort();
                    params.append('o', listenerPort!.toString());
                }
                
                const queryString = params.toString();
                if (queryString) {
                    url += `?${queryString}`;
                }
                
                vscode.env.openExternal(vscode.Uri.parse(url));
                return;
            }

            // Start slides renderer
            const configuredPort = getRendererPortFromSettings();
            const port = configuredPort > 0 ? configuredPort : undefined;
            const serverPort = await slidesRendererServer.start(port);
            
            vscode.commands.executeCommand('setContext', 'lutexSlidesRendererActive', true);
            statusBar.setSlidesRendererStatus(true, serverPort);
            
            // Build URL with parameters
            let url = `http://localhost:${serverPort}`;
            const params = new URLSearchParams();
            
            // Add markdown file parameter
            params.append('f', markdownFileName || 'main.md');
            
            if (listenerServer.isRunning()) {
                const listenerPort = listenerServer.getPort();
                params.append('o', listenerPort!.toString());
            }
            
            const queryString = params.toString();
            if (queryString) {
                url += `?${queryString}`;
            }
            
            // Automatically open browser
            vscode.env.openExternal(vscode.Uri.parse(url));
            outputChannel.appendLine(`[LuTeX] Slides renderer started on port ${serverPort} with listener integration (file: ${markdownFileName || 'main.md'})`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start Slides renderer: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Launch Slides renderer error: ${errorMessage}`);
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
        
        if (slidesRendererServer.isRunning()) {
            slidesRendererServer.stop();
            vscode.commands.executeCommand('setContext', 'lutexSlidesRendererActive', false);
            statusBar.setSlidesRendererStatus(false);
            stopped.push('Slides renderer');
            outputChannel.appendLine('[LuTeX] Slides renderer stopped');
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

    // Jump to Slides (slides renderer or static page connected to listener)
    const jumpToSlidesCommand = vscode.commands.registerCommand('lutex-ext.jumpToSlides', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            outputChannel.appendLine('[LuTeX] No active editor');
            return;
        }

        if (!listenerServer.isRunning()) {
            outputChannel.appendLine('[LuTeX] Listener server not running');
            vscode.window.showWarningMessage('Listener server is not running. Please start it or launch Slides with Listener.');
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const lineNumber = position.line + 1;
        const fileName = path.relative(vscode.workspace.workspaceFolders?.[0].uri.fsPath || '', document.fileName);

        outputChannel.appendLine(`[LuTeX] Sending slides jump request for ${fileName}:${lineNumber}`);
        listenerServer.notifyScroll(fileName, lineNumber);
    });


    // Export Slides to PDF
    const exportSlidesToPdfCommand = vscode.commands.registerCommand('lutex-ext.exportSlidesToPdf', async () => {
        try {
            // Check if slides renderer is running
            if (!slidesRendererServer.isRunning()) {
                vscode.window.showErrorMessage('Slides renderer is not running. Please launch slides first.');
                return;
            }

            const port = slidesRendererServer.getPort();
            if (!port) {
                vscode.window.showErrorMessage('Cannot determine slides server port.');
                return;
            }

            // Ask user for resolution
            const resolutionOptions = [
                { label: '1920x1080 (Full HD 16:9)', width: 1920, height: 1080 },
                { label: '1440x1080 (4:3)', width: 1440, height: 1080 },
                { label: '1280x720 (HD 16:9)', width: 1280, height: 720 },
                { label: '1600x1200 (4:3)', width: 1600, height: 1200 },
                { label: 'Custom...', width: 0, height: 0 }
            ];

            const selectedResolution = await vscode.window.showQuickPick(
                resolutionOptions.map(opt => opt.label),
                {
                    placeHolder: 'Select PDF resolution',
                    title: 'Export Slides to PDF'
                }
            );

            if (!selectedResolution) {
                return;
            }

            let width: number;
            let height: number;

            if (selectedResolution === 'Custom...') {
                // Ask for custom dimensions
                const dimensionInput = await vscode.window.showInputBox({
                    prompt: 'Enter resolution (e.g., 1920x1080)',
                    placeHolder: '1920x1080',
                    validateInput: (value) => {
                        const match = value.match(/^(\d+)[x*](\d+)$/);
                        if (!match) {
                            return 'Invalid format. Use: widthxheight (e.g., 1920x1080)';
                        }
                        return null;
                    }
                });

                if (!dimensionInput) {
                    return;
                }

                const match = dimensionInput.match(/^(\d+)[x*](\d+)$/);
                if (!match) {
                    return;
                }

                width = parseInt(match[1], 10);
                height = parseInt(match[2], 10);
            } else {
                const selected = resolutionOptions.find(opt => opt.label === selectedResolution);
                if (!selected) {
                    return;
                }
                width = selected.width;
                height = selected.height;
            }

            // Ask user for save location
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found.');
                return;
            }

            const defaultPath = vscode.Uri.joinPath(workspaceFolder.uri, 'out', 'slides.pdf');
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: defaultPath,
                filters: {
                    'PDF Files': ['pdf']
                },
                saveLabel: 'Export PDF',
                title: 'Save Slides as PDF'
            });

            if (!saveUri) {
                return;
            }

            outputChannel.appendLine(`[LuTeX] Starting PDF export: ${width}x${height} to ${saveUri.fsPath}`);
            
            // Show progress notification
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Exporting Slides to PDF',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Initializing...' });

                // Build the slides URL
                const editor = vscode.window.activeTextEditor;
                let markdownFileName = 'main.md';
                
                if (editor && editor.document.languageId === 'markdown') {
                    if (workspaceFolder) {
                        const relativePath = path.relative(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
                        markdownFileName = relativePath.replace(/\\/g, '/');
                    }
                }

                const params = new URLSearchParams();
                params.append('f', markdownFileName);
                if (listenerServer.isRunning()) {
                    const listenerPort = listenerServer.getPort();
                    if (listenerPort) {
                        params.append('o', listenerPort.toString());
                    }
                }

                const url = `http://localhost:${port}?${params.toString()}`;

                progress.report({ message: 'Generating PDF...' });

                // Get Chrome path from settings
                const chromePath = getChromePathFromSettings();

                try {
                    const outputPath = await generateSlidePDF({
                        url,
                        width,
                        height,
                        outputPath: saveUri.fsPath,
                        executablePath: chromePath
                    }, outputChannel);

                    progress.report({ message: 'Complete!' });
                    
                    const message = outputPath.includes('Note:') 
                        ? 'PDF exported (single page). For multi-slide PDFs, install: npm install -g puppeteer'
                        : 'PDF exported successfully';
                    
                    vscode.window.showInformationMessage(
                        `${message}: ${path.basename(outputPath)}`,
                        'Open File',
                        'Show in Explorer'
                    ).then(selection => {
                        if (selection === 'Open File') {
                            vscode.env.openExternal(vscode.Uri.file(outputPath));
                        } else if (selection === 'Show in Explorer') {
                            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
                        }
                    });
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Failed to export PDF: ${errorMsg}`);
                    outputChannel.appendLine(`[LuTeX] Export error: ${errorMsg}`);
                }
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to export slides to PDF: ${errorMessage}`);
            outputChannel.appendLine(`[LuTeX] Export slides to PDF error: ${errorMessage}`);
        }
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
        
        if (!slidesRendererServer.isRunning()) {
            options.push({
                label: '$(play) Launch Slides Renderer with Listener',
                description: 'Start Slides renderer and listener',
                detail: 'Opens a browser with the Slides renderer'
            });
        } else {
            options.push({
                label: '$(debug-stop) Stop Slides Renderer',
                description: `Currently running on port ${slidesRendererServer.getPort()}`,
                detail: 'Stop the Slides renderer'
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
        if (texRendererServer.isRunning() || mdRendererServer.isRunning() || slidesRendererServer.isRunning() || listenerServer.isRunning()) {
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
        } else if (selection.label.includes('Slides Renderer with Listener')) {
            await vscode.commands.executeCommand('lutex-ext.launchSlidesWithListener');
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
        } else if (selection.label.includes('Stop Slides Renderer')) {
            if (slidesRendererServer.isRunning()) {
                slidesRendererServer.stop();
                vscode.commands.executeCommand('setContext', 'lutexSlidesRendererActive', false);
                statusBar.setSlidesRendererStatus(false);
                outputChannel.appendLine('[LuTeX] Slides renderer stopped');
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
        launchSlidesWithListenerCommand,
        launchListenerCommand,
        closeAllCommand,
        jumpToHtmlCommand,
        exportSlidesToPdfCommand,
        showStatusCommand,
        jumpToSlidesCommand,
        statusBar
    );

    // Auto-launch based on settings
    const autoLaunch = getAutoLaunchFromSettings();
    if (autoLaunch !== 'none') {
        outputChannel.appendLine(`[LuTeX] Auto-launch mode: ${autoLaunch}`);
        
        // Use setTimeout to defer auto-launch after activation completes
        setTimeout(async () => {
            try {
                if (autoLaunch === 'slides') {
                    await vscode.commands.executeCommand('lutex-ext.launchSlidesWithListener');
                } else if (autoLaunch === 'tex') {
                    await vscode.commands.executeCommand('lutex-ext.launchLutexWithListener');
                } else if (autoLaunch === 'listener') {
                    await vscode.commands.executeCommand('lutex-ext.launchListener');
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                outputChannel.appendLine(`[LuTeX] Auto-launch failed: ${errorMsg}`);
            }
        }, 1000);
    }

    // Clean up when the extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            listenerServer.stop();
            texRendererServer.stop();
            mdRendererServer.stop();
            slidesRendererServer.stop();
            vscode.commands.executeCommand('setContext', 'lutexRendererActive', false);
            vscode.commands.executeCommand('setContext', 'lutexMarkdownRendererActive', false);
            vscode.commands.executeCommand('setContext', 'lutexSlidesRendererActive', false);
            outputChannel.dispose();
        }
    });
}

export function deactivate() {} 
