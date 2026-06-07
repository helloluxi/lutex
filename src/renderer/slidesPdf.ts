import * as fs from 'fs';
import * as path from 'path';

// `document`/`window` are referenced only inside page.evaluate callbacks (run in the browser);
// declared as any so this Node build needs no DOM lib.
declare const document: any;
declare const window: any;

export interface SlidesPdfOptions {
    /** URL of a running slides renderer (e.g. http://127.0.0.1:12044/?f=deck.md). */
    url: string;
    width: number;
    height: number;
    /** Output path; defaults to the page title under cwd. */
    outputPath?: string;
    /** System Chrome/Chromium binary; auto-detected when omitted. */
    executablePath?: string;
    /** Replaces the `#current-date` element's text when set. */
    date?: string;
    log: (msg: string) => void;
}

/** Optional deps are loaded lazily so the rest of the CLI works without them installed. */
function loadOptional(name: string): unknown {
    try {
        return require(name);
    } catch {
        return null;
    }
}

const CHROME_CANDIDATES: Record<string, string[]> = {
    win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
    darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/snap/bin/chromium',
    ],
};

function findChromeExecutable(): string | undefined {
    return (CHROME_CANDIDATES[process.platform] ?? CHROME_CANDIDATES.linux).find(p => fs.existsSync(p));
}

function resolveOutputPath(targetPath: string): string {
    const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
    return path.extname(resolved) ? resolved : `${resolved}.pdf`;
}

/**
 * Drive a running slides renderer with Puppeteer (using system Chrome), render each slide to its own
 * PDF page via `window.slidesApp`, and combine them with pdf-lib. Returns the written path.
 * Throws with a clear message if Chrome / puppeteer / pdf-lib are missing.
 */
export async function exportSlidesPdf(options: SlidesPdfOptions): Promise<string> {
    const { url, width, height, log } = options;

    const chromePath = options.executablePath || findChromeExecutable();
    if (!chromePath) {
        throw new Error('Chrome/Chromium not found. Install it or pass --chrome <path>.');
    }
    const puppeteer = loadOptional('puppeteer') as any;
    if (!puppeteer) {
        throw new Error("puppeteer not installed. Run: pnpm add puppeteer (Chromium download is skipped; system Chrome is used).");
    }
    const pdfLib = loadOptional('pdf-lib') as any;
    if (!pdfLib) {
        throw new Error('pdf-lib not installed. Run: pnpm add pdf-lib');
    }
    const PDFDocument = pdfLib.PDFDocument;

    log(`[slides-pdf] Chrome: ${chromePath}`);
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });

        log(`[slides-pdf] loading ${url}`);
        await page.goto(url, { waitUntil: ['load', 'domcontentloaded'], timeout: 60000 });
        await page.waitForSelector('.slides-container', { timeout: 10000 });
        await page.waitForFunction(
            () => !document.fonts || document.fonts.status === 'loaded',
            { timeout: 7000 },
        ).catch(() => log('[slides-pdf] font load timeout (continuing)'));

        const title = await page.title();
        const safeTitle = title.trim()
            ? `${title.trim().replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`
            : 'slides.pdf';
        const output = resolveOutputPath(options.outputPath || safeTitle);

        await page.waitForFunction(
            () => (window as any).slidesApp && (window as any).slidesApp.getTotalSlides() > 0,
            { timeout: 10000 },
        );
        const totalSlides: number = await page.evaluate(() => (window as any).slidesApp.getTotalSlides());

        if (options.date && options.date.trim()) {
            await page.evaluate((dateText: string) => {
                const el = document.getElementById('current-date');
                if (el) {
                    el.textContent = dateText;
                }
            }, options.date.trim());
        }

        await page.addStyleTag({ content: pdfPrintCss(width, height) });

        const pdfPages: Uint8Array[] = [];
        for (let i = 0; i < totalSlides; i++) {
            log(`[slides-pdf] rendering slide ${i + 1}/${totalSlides}`);
            await page.evaluate((index: number) => (window as any).slidesApp.goToSlide(index), i);
            await new Promise(r => setTimeout(r, 800));
            await page.waitForFunction((index: number) => (window as any).slidesApp.getCurrentSlide() === index, {}, i);
            await page.waitForFunction(() => {
                const math = document.querySelectorAll('.katex');
                return math.length === 0 || Array.from(math).every((el: any) => el.textContent?.trim() !== '');
            }, { timeout: 3000 }).catch(() => log(`[slides-pdf] math render timeout on slide ${i + 1}`));

            pdfPages.push(await page.pdf({
                width: `${width}px`,
                height: `${height}px`,
                printBackground: true,
                margin: { top: 0, right: 0, bottom: 0, left: 0 },
                scale: 1,
                preferCSSPageSize: false,
                displayHeaderFooter: false,
                pageRanges: '1',
            }));
        }

        log(`[slides-pdf] combining ${pdfPages.length} pages`);
        const combined = await combinePdfs(pdfPages, title, PDFDocument);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, combined);
        log(`[slides-pdf] wrote ${output}`);
        return output;
    } finally {
        await browser.close();
    }
}

async function combinePdfs(pages: Uint8Array[], title: string, PDFDocument: any): Promise<Uint8Array> {
    const out = await PDFDocument.create();
    out.setTitle(title || 'Slides');
    out.setCreator('lutex');
    out.setProducer('puppeteer + pdf-lib');
    for (const buf of pages) {
        const doc = await PDFDocument.load(buf);
        const copied = await out.copyPages(doc, doc.getPageIndices());
        copied.forEach((p: any) => out.addPage(p));
    }
    return out.save();
}

function pdfPrintCss(width: number, height: number): string {
    return `
        @page { size: ${width}px ${height}px; margin: 0; }
        html, body {
            margin: 0 !important; padding: 0 !important;
            width: 100vw !important; height: 100vh !important;
            overflow: hidden !important;
        }
        .progress-container, .slide-number, .nav-arrow, .copy-button { display: none !important; }
        .slides-container { width: 100vw !important; height: 100vh !important; }
        .slide { page-break-after: always !important; page-break-inside: avoid !important; }
        @media print {
            * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
    `;
}
