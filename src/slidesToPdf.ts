import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

export interface Slides2PdfOptions {
    url: string;
    width: number;
    height: number;
    outputPath: string;
    executablePath?: string;
    date?: string;
}

/**
 * Check if a global npm package is available
 */
function isGlobalPackageAvailable(packageName: string): boolean {
    try {
        const result = child_process.execSync(`npm list -g ${packageName} --depth=0`, {
            encoding: 'utf8',
            stdio: 'pipe'
        });
        return result.includes(packageName);
    } catch {
        return false;
    }
}

/**
 * Get global npm root directory
 */
function getGlobalNpmRoot(): string | null {
    try {
        const result = child_process.execSync('npm root -g', {
            encoding: 'utf8',
            stdio: 'pipe'
        });
        return result.trim();
    } catch {
        return null;
    }
}

/**
 * Require a global npm package
 */
function requireGlobal(packageName: string): any {
    const globalRoot = getGlobalNpmRoot();
    if (!globalRoot) {
        throw new Error('Cannot determine global npm root directory');
    }

    const packagePath = path.join(globalRoot, packageName);
    
    if (!fs.existsSync(packagePath)) {
        throw new Error(`Global package ${packageName} not found at ${packagePath}`);
    }

    // Add global node_modules to module paths so nested dependencies resolve
    const Module = require('module');
    const originalPaths = Module._nodeModulePaths;
    
    Module._nodeModulePaths = function(from: string) {
        const paths = originalPaths.call(this, from);
        if (globalRoot && !paths.includes(globalRoot)) {
            paths.unshift(globalRoot);
        }
        return paths;
    };

    try {
        return require(packagePath);
    } catch (error) {
        throw new Error(`Failed to load ${packageName}: ${error}`);
    }
}

/**
 * Find Chrome executable path
 */
function findChromeExecutable(): string | undefined {
    const possiblePaths = process.platform === 'win32' ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ] : process.platform === 'darwin' ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ] : [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
    ];

    for (const chromePath of possiblePaths) {
        if (fs.existsSync(chromePath)) {
            return chromePath;
        }
    }

    return undefined;
}

/**
 * Show error dialog with instructions for missing dependencies
 */
async function showDependencyError(
    missing: 'chrome' | 'puppeteer' | 'pdf-lib',
    outputChannel: vscode.OutputChannel
): Promise<void> {
    let message: string;
    let actions: string[];
    
    if (missing === 'chrome') {
        message = 'Chrome/Chromium browser not found. Please install Chrome or configure the path in settings.';
        actions = ['Install Chrome', 'Open Settings', 'Cancel'];
        
        outputChannel.appendLine('[Slides2PDF] ❌ Chrome not found');
        outputChannel.appendLine('[Slides2PDF] Searched locations:');
        if (process.platform === 'win32') {
            outputChannel.appendLine('  - C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
            outputChannel.appendLine('  - C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
            outputChannel.appendLine('  - %LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe');
        }
    } else if (missing === 'puppeteer') {
        message = 'Puppeteer not found globally. Multi-slide PDF export requires Puppeteer.';
        actions = ['Copy Install Command', 'Learn More', 'Cancel'];
        
        outputChannel.appendLine('[Slides2PDF] ❌ Puppeteer not found');
        outputChannel.appendLine('[Slides2PDF] Install command (run in terminal):');
        outputChannel.appendLine('  Windows (PowerShell): $env:PUPPETEER_SKIP_DOWNLOAD=\'true\'; npm install -g puppeteer');
        outputChannel.appendLine('  macOS/Linux: PUPPETEER_SKIP_DOWNLOAD=true npm install -g puppeteer');
    } else {
        message = 'pdf-lib not found globally. Required for combining PDF pages.';
        actions = ['Copy Install Command', 'Learn More', 'Cancel'];
        
        outputChannel.appendLine('[Slides2PDF] ❌ pdf-lib not found');
        outputChannel.appendLine('[Slides2PDF] Install command: npm install -g pdf-lib');
    }
    
    const selection = await vscode.window.showErrorMessage(message, ...actions);
    
    if (selection === 'Install Chrome') {
        vscode.env.openExternal(vscode.Uri.parse('https://www.google.com/chrome/'));
    } else if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'lutex-ext.chromePath');
    } else if (selection === 'Copy Install Command') {
        let command: string;
        if (missing === 'puppeteer') {
            command = process.platform === 'win32' 
                ? '$env:PUPPETEER_SKIP_DOWNLOAD=\'true\'; npm install -g puppeteer'
                : 'PUPPETEER_SKIP_DOWNLOAD=true npm install -g puppeteer';
            outputChannel.appendLine('[Slides2PDF] Command copied to clipboard. Please run it in your terminal.');
            outputChannel.appendLine(`[Slides2PDF] Command: ${command}`);
        } else {
            command = 'npm install -g pdf-lib';
        }
        vscode.env.clipboard.writeText(command);
        vscode.window.showInformationMessage('Install command copied to clipboard! Paste and run it in your terminal.');
    } else if (selection === 'Learn More') {
        const docPath = path.join(__dirname, '..', 'PDF_EXPORT.md');
        if (fs.existsSync(docPath)) {
            vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(docPath));
        }
    }
}

/**
 * Generate PDF from HTML slides using globally installed Puppeteer or system Chrome
 */
export async function generateSlidePDF(
    options: Slides2PdfOptions,
    outputChannel: vscode.OutputChannel
): Promise<string> {
    const { executablePath } = options;

    // Check for Chrome first
    const chromePath = executablePath || findChromeExecutable();
    
    if (!chromePath) {
        await showDependencyError('chrome', outputChannel);
        throw new Error('Chrome/Chromium not found. Please install Chrome or configure chromePath in settings.');
    }

    outputChannel.appendLine(`[Slides2PDF] Using Chrome at: ${chromePath}`);

    // Check if global Puppeteer is available
    const hasPuppeteer = isGlobalPackageAvailable('puppeteer');
    const hasPdfLib = isGlobalPackageAvailable('pdf-lib');

    if (hasPuppeteer && hasPdfLib) {
        outputChannel.appendLine('[Slides2PDF] Using globally installed Puppeteer for multi-slide PDF...');
        return await generatePDFWithPuppeteer(options, outputChannel, chromePath);
    } else {
        if (!hasPuppeteer) {
            outputChannel.appendLine('[Slides2PDF] ❌ Puppeteer not found globally');
            await showDependencyError('puppeteer', outputChannel);
            throw new Error('Puppeteer is required for PDF export. Please install it globally.');
        }
        if (!hasPdfLib) {
            outputChannel.appendLine('[Slides2PDF] ❌ pdf-lib not found globally');
            await showDependencyError('pdf-lib', outputChannel);
            throw new Error('pdf-lib is required for PDF export. Please install it globally.');
        }
        
        throw new Error('Required dependencies not found.');
    }
}

/**
 * Generate PDF using system Chrome/Chromium (basic mode - single page)
 */
async function generatePDFWithSystemChrome(
    options: Slides2PdfOptions,
    outputChannel: vscode.OutputChannel,
    chromePath: string
): Promise<string> {
    const { url, outputPath } = options;

    const resolvedOutput = resolveOutputPath(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

    // Use Chrome headless to print to PDF
    const args = [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--print-to-pdf=' + resolvedOutput,
        '--virtual-time-budget=10000',
        url
    ];

    return new Promise((resolve, reject) => {
        const chromeProcess = child_process.spawn(chromePath, args, {
            stdio: 'pipe'
        });

        let stderr = '';
        chromeProcess.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        chromeProcess.on('close', (code) => {
            if (code === 0 && fs.existsSync(resolvedOutput)) {
                outputChannel.appendLine(`[Slides2PDF] ✅ Basic PDF generated: ${resolvedOutput}`);
                outputChannel.appendLine(`[Slides2PDF] Note: This is a single-page PDF.`);
                outputChannel.appendLine(`[Slides2PDF] For multi-slide PDF, install: npm install -g puppeteer pdf-lib`);
                resolve(resolvedOutput);
            } else {
                const error = `Chrome exited with code ${code}. ${stderr}`;
                outputChannel.appendLine(`[Slides2PDF] ❌ ${error}`);
                reject(new Error(error));
            }
        });

        chromeProcess.on('error', (error) => {
            outputChannel.appendLine(`[Slides2PDF] ❌ Failed to launch Chrome: ${error.message}`);
            reject(error);
        });
    });
}

/**
 * Generate PDF using globally installed Puppeteer (full multi-slide support)
 */
async function generatePDFWithPuppeteer(
    options: Slides2PdfOptions,
    outputChannel: vscode.OutputChannel,
    chromePath: string
): Promise<string> {
    const globalRoot = getGlobalNpmRoot();
    if (!globalRoot) {
        throw new Error('Cannot find global npm directory');
    }

    outputChannel.appendLine(`[Slides2PDF] Global npm root: ${globalRoot}`);
    
    // Load global packages
    let puppeteer: any;
    let PDFDocument: any;
    
    try {
        outputChannel.appendLine(`[Slides2PDF] Loading Puppeteer...`);
        puppeteer = requireGlobal('puppeteer');
    } catch (error) {
        outputChannel.appendLine(`[Slides2PDF] ❌ Failed to load Puppeteer: ${error}`);
        await showDependencyError('puppeteer', outputChannel);
        throw error;
    }
    
    try {
        outputChannel.appendLine(`[Slides2PDF] Loading pdf-lib...`);
        const pdfLib = requireGlobal('pdf-lib');
        PDFDocument = pdfLib.PDFDocument;
    } catch (error) {
        outputChannel.appendLine(`[Slides2PDF] ❌ Failed to load pdf-lib: ${error}`);
        await showDependencyError('pdf-lib', outputChannel);
        throw error;
    }
    const { url, width, height, outputPath } = options;

    const launchOptions: any = {
        headless: 'new' as any,
        executablePath: chromePath,  // Use system Chrome
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    };

    outputChannel.appendLine(`[Slides2PDF] Launching browser...`);
    const browser = await puppeteer.launch(launchOptions);

    try {
        const page = await browser.newPage();

        // Set viewport to match PDF dimensions
        await page.setViewport({
            width: width,
            height: height,
            deviceScaleFactor: 1
        });

        outputChannel.appendLine(`[Slides2PDF] Navigating to ${url}...`);
        // Navigate to the slides URL
        await page.goto(url, {
            waitUntil: ['load', 'domcontentloaded'],
            timeout: 60000
        });

        // Wait for slides to be fully loaded
        await page.waitForSelector('.slides-container', { timeout: 10000 });
        await page.waitForFunction(() => {
            // @ts-ignore - Running in browser context
            return !document.fonts || document.fonts.status === 'loaded';
        }, { timeout: 7000 }).catch(() => {
            outputChannel.appendLine(`[Slides2PDF] Font loading timeout (continuing anyway)`);
        });

        // Get the page title for PDF filename
        const title = await page.title();
        const safeTitle = title.trim()
            ? `${title.trim().replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`
            : 'slides.pdf';
        const resolvedOutput = resolveOutputPath(outputPath || safeTitle);

        // Wait for JavaScript to initialize slides
        await page.waitForFunction(() => {
            // @ts-ignore - Running in browser context
            return window.slidesApp && window.slidesApp.getTotalSlides() > 0;
        }, { timeout: 10000 });

        // Get total number of slides
        const totalSlides = await page.evaluate(() => {
            // @ts-ignore - Running in browser context
            return window.slidesApp.getTotalSlides();
        });

        const outputLabel = path.basename(resolvedOutput);
        outputChannel.appendLine(`[Slides2PDF] Found ${totalSlides} slides. Generating PDF: ${outputLabel} (${width}x${height})`);

        // Replace current-date element if date is provided
        if (options.date && options.date.trim() !== '') {
            await page.evaluate((dateText: string) => {
                // @ts-ignore - Running in browser context
                const dateElement = document.getElementById('current-date');
                if (dateElement) {
                    dateElement.textContent = dateText;
                }
            }, options.date.trim());
            outputChannel.appendLine(`[Slides2PDF] Set date to: ${options.date.trim()}`);
        }

        // Apply PDF styles optimized for Chrome presentation mode
        await page.addStyleTag({
            content: `
                @page {
                    size: ${width}px ${height}px;
                    margin: 0;
                }
                html, body {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background-color: var(--bg-primary, #f8f9fa) !important;
                    overflow: hidden !important;
                }
                .progress-container,
                .slide-number,
                .nav-arrow,
                .copy-button {
                    display: none !important;
                }
                .slides-container {
                    width: 100vw !important;
                    height: 100vh !important;
                }
                .slide {
                    page-break-after: always !important;
                    page-break-inside: avoid !important;
                }
                /* Fix shadow rendering for PDF - use medium gray with good visibility */
                .column {
                    box-shadow: 0 4px 6px rgba(150, 150, 150, 0.3) !important;
                }
                .figure img {
                    box-shadow: 0 4px 8px rgba(150, 150, 150, 0.25) !important;
                }
                .compare-item {
                    box-shadow: 0 2px 5px rgba(150, 150, 150, 0.25) !important;
                }
                .qr-box {
                    box-shadow: 0 4px 10px rgba(150, 150, 150, 0.3) !important;
                }
                .container {
                    box-shadow: 0 4px 6px rgba(150, 150, 150, 0.25) !important;
                }
                .play-pause-btn {
                    box-shadow: 0 2px 8px rgba(0, 123, 255, 0.15) !important;
                }
                .play-pause-btn:hover {
                    box-shadow: 0 4px 12px rgba(0, 123, 255, 0.2) !important;
                }
                /* Ensure consistent shadow variables for PDF */
                :root {
                    --shadow-light: rgba(150, 150, 150, 0.25) !important;
                    --shadow-medium: rgba(130, 130, 130, 0.3) !important;
                }
                /* Target specific elements that use shadow variables */
                .instance-container {
                    box-shadow: 0 2px 4px rgba(0, 123, 255, 0.08) !important;
                }
                /* Ensure footnote rule is visible in PDF - matching HTML styles */
                .footnote {
                    position: relative !important;
                }
                .footnote::before {
                    content: '' !important;
                    display: block !important;
                    position: absolute !important;
                    top: 0 !important;
                    left: 2rem !important;
                    right: 2rem !important;
                    height: 1px !important;
                    background-color: #333 !important;
                }
                @media print {
                    * {
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        -webkit-filter: none !important;
                        filter: none !important;
                    }
                    /* Maintain visible but lighter shadows in print */
                    .column {
                        box-shadow: 0 3px 5px rgba(170, 170, 170, 0.25) !important;
                    }
                    .figure img {
                        box-shadow: 0 3px 6px rgba(170, 170, 170, 0.2) !important;
                    }
                    .compare-item {
                        box-shadow: 0 2px 4px rgba(170, 170, 170, 0.2) !important;
                    }
                    .qr-box {
                        box-shadow: 0 3px 8px rgba(170, 170, 170, 0.25) !important;
                    }
                    .container {
                        box-shadow: 0 3px 5px rgba(170, 170, 170, 0.2) !important;
                    }
                    /* Ensure footnote rule is visible in print mode */
                    .footnote {
                        position: relative !important;
                    }
                    .footnote::before {
                        content: '' !important;
                        display: block !important;
                        background-color: #333 !important;
                    }
                }
            `
        });

        // Generate PDF pages for each slide
        const pdfPages: Uint8Array[] = [];

        for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
            outputChannel.appendLine(`[Slides2PDF] Rendering slide ${slideIndex + 1}/${totalSlides}...`);

            // Navigate to specific slide
            await page.evaluate((index: number) => {
                // @ts-ignore - Running in browser context
                window.slidesApp.goToSlide(index);
            }, slideIndex);

            // Wait for slide transition to complete
            await new Promise(resolve => setTimeout(resolve, 800));

            // Wait for any animations or content to load
            await page.waitForFunction((index: number) => {
                // @ts-ignore - Running in browser context
                return window.slidesApp.getCurrentSlide() === index;
            }, {}, slideIndex);

            // Wait for any KaTeX math rendering to complete
            await page.waitForFunction(() => {
                // @ts-ignore - Running in browser context
                const mathElements = document.querySelectorAll('.katex');
                return mathElements.length === 0 ||
                    // @ts-ignore - Running in browser context
                    Array.from(mathElements).every((el: any) => el.textContent?.trim() !== '');
            }, { timeout: 3000 }).catch(() => {
                outputChannel.appendLine(`[Slides2PDF] Math rendering timeout for slide ${slideIndex + 1}`);
            });

            // Generate PDF optimized for Chrome presentation mode
            const pdf = await page.pdf({
                width: `${width}px`,      // Match viewport width
                height: `${height}px`,    // Match viewport height  
                printBackground: true,
                margin: {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: 0
                },
                scale: 1,
                preferCSSPageSize: false,
                displayHeaderFooter: false,
                pageRanges: '1'
            });

            pdfPages.push(pdf);
        }

        // Combine all PDF pages into a single PDF
        outputChannel.appendLine(`[Slides2PDF] Combining ${pdfPages.length} pages...`);
        const combinedPdf = await combinePDFs(pdfPages, title, PDFDocument);

        // Save the final PDF
        fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        fs.writeFileSync(resolvedOutput, combinedPdf);

        outputChannel.appendLine(`[Slides2PDF] ✅ PDF generated successfully: ${resolvedOutput}`);
        return resolvedOutput;

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`[Slides2PDF] ❌ Error generating PDF: ${errorMsg}`);
        throw error;
    } finally {
        await browser.close();
    }
}

/**
 * Resolve output path, ensuring it's absolute and has .pdf extension
 */
function resolveOutputPath(targetPath: string): string {
    const hasExtension = path.extname(targetPath) !== '';
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
    return hasExtension ? resolved : `${resolved}.pdf`;
}

/**
 * Combine multiple PDF buffers into a single PDF using globally installed pdf-lib
 */
async function combinePDFs(pdfBuffers: Uint8Array[], title: string, PDFDocument: any): Promise<Uint8Array> {
    const combinedPdf = await PDFDocument.create();

    // Add basic metadata for presentation mode
    combinedPdf.setTitle(title || 'HTML Slides');
    combinedPdf.setSubject('Generated from HTML slides for Chrome presentation');
    combinedPdf.setCreator('HTML Slides to PDF Converter');
    combinedPdf.setProducer('Puppeteer + pdf-lib');

    for (const pdfBuffer of pdfBuffers) {
        const pdf = await PDFDocument.load(pdfBuffer);
        const pages = await combinedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page: any) => combinedPdf.addPage(page));
    }

    return await combinedPdf.save();
}
