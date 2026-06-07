#!/usr/bin/env node
import * as path from 'path';
import * as http from 'http';
import { execSync } from 'child_process';
import { NvimController } from './listener/nvim';
import { ListenerServer } from './listener/server';
import { resolveConfig, resolveRendererOptions, RendererOptions } from './listener/config';
import { RendererKind, startStandaloneRenderer } from './renderer/assets';
import { exportSlidesPdf } from './renderer/slidesPdf';
import { cleanBibtexFile, findSimilarPairs } from './lib/bibtexClean';

function usage(): void {
    console.error(`Usage: lutex <command> [options]

Commands:
  listen [--port N] [--nvim SOCK] [--allow-lan]
            Start the daemon bound to a running nvim (jump listener + renderer + SSE on one port).

  tex | md | slides [file] [--root DIR] [--theme light|dark] [--port N]
            Open a browser preview against the daemon (default port 12023). Run :LutexListen first.

  slides-pdf <file.md> [--res WxH] [--out FILE] [--chrome PATH] [--date STR]
            Export a slides deck to a multi-page PDF (needs puppeteer + system Chrome).

  bibtex-clean <file.bib> [--root DIR] [--dump-similar] [--decisions JSON]
            Dedupe, strip abstracts, normalize months, and prune unused entries (backs up to
            <file>.bib.backup). --dump-similar prints similar-title pairs as JSON without writing;
            --decisions '{"loser":"winner"}' merges those pairs.`);
}

const log = (msg: string) => console.error(msg);

function openBrowser(url: string): void {
    try {
        execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    } catch {
        // browser open failed; the URL is printed for the user to open manually
    }
}

async function runListen(argv: string[]): Promise<void> {
    const cfg = resolveConfig(argv.slice(3), process.cwd());

    let socket: string;
    try {
        socket = NvimController.resolveSocket(cfg.nvimSocket);
    } catch (err) {
        console.error(`[lutex] ${(err as Error).message}`);
        process.exit(1);
    }

    const nvim = new NvimController(socket);
    const server = new ListenerServer({ nvim, log, macros: cfg.katexMacros });
    const hostname = cfg.allowLAN ? '0.0.0.0' : '127.0.0.1';

    const port = await server.start(cfg.port, hostname);
    // stdout carries only this line so the Lua shim can parse the bound port from jobstart stdout.
    console.log(`LUTEX_LISTENING ${port}`);
    console.error(`[lutex] daemon ready on ${hostname}:${port} (nvim: ${socket})`);

    const shutdown = () => {
        server.stop();
        setTimeout(() => process.exit(0), 150);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

/** Probe whether a daemon is accepting connections on the given port. */
function daemonAlive(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'OPTIONS', timeout: 800 }, res => {
            res.resume();
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.end();
    });
}

/** The page-relative `f` value: absolute for markdown/slides, none for tex (which hardcodes main.tex). */
function fileParam(kind: RendererKind, opts: RendererOptions): string | undefined {
    return kind === 'tex' ? undefined : opts.file;
}

async function runRenderer(kind: RendererKind, argv: string[]): Promise<void> {
    const opts = resolveRendererOptions(argv.slice(3), process.cwd());

    if (!(await daemonAlive(opts.daemonPort))) {
        console.error(`[lutex] no daemon on :${opts.daemonPort}. Run :LutexListen in nvim (or pass --port).`);
        process.exit(1);
    }

    const query = new URLSearchParams({ view: kind, m: opts.theme });
    if (kind === 'tex') {
        query.set('root', opts.root);
    }
    const f = fileParam(kind, opts);
    if (f) {
        query.set('file', f);
    }
    const url = `http://127.0.0.1:${opts.daemonPort}/?${query.toString()}`;

    console.log(url);
    openBrowser(url);
}

function parseResolution(value: string | undefined): { width: number; height: number } {
    const m = /^(\d+)x(\d+)$/.exec(value ?? '');
    return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1280, height: 720 };
}

function flagValue(args: string[], name: string): string | undefined {
    const eq = args.find(a => a.startsWith(`${name}=`));
    if (eq) {
        return eq.slice(name.length + 1);
    }
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
}

async function runSlidesPdf(argv: string[]): Promise<void> {
    const args = argv.slice(3);
    const positional = args.find(a => !a.startsWith('-'));
    if (!positional) {
        console.error('Usage: lutex slides-pdf <file.md> [--res WxH] [--out FILE] [--chrome PATH] [--date STR]');
        process.exit(1);
    }
    const file = path.resolve(process.cwd(), positional);
    const { width, height } = parseResolution(flagValue(args, '--res'));

    const renderer = await startStandaloneRenderer({ root: path.dirname(file), log });
    const url = `http://127.0.0.1:${renderer.port}/?view=slides&file=${encodeURIComponent(file)}`;

    try {
        const output = await exportSlidesPdf({
            url,
            width,
            height,
            outputPath: flagValue(args, '--out'),
            executablePath: flagValue(args, '--chrome'),
            date: flagValue(args, '--date'),
            log,
        });
        console.log(output);
    } catch (err) {
        console.error(`[lutex] slides-pdf failed: ${(err as Error).message}`);
        process.exitCode = 1;
    } finally {
        renderer.stop();
    }
}

function runBibtexClean(argv: string[]): void {
    const args = argv.slice(3);
    const positional = args.find(a => !a.startsWith('-'));
    if (!positional || !positional.endsWith('.bib')) {
        console.error('Usage: lutex bibtex-clean <file.bib> [--root DIR] [--dump-similar] [--decisions JSON]');
        process.exit(1);
    }
    const bibPath = path.resolve(process.cwd(), positional);
    const rootFlag = flagValue(args, '--root');
    const root = rootFlag ? path.resolve(process.cwd(), rootFlag) : path.dirname(bibPath);

    if (args.includes('--dump-similar')) {
        // Machine-readable pairs on stdout (for an external merge picker to consume); nothing is written.
        console.log(JSON.stringify(findSimilarPairs(bibPath)));
        return;
    }

    let decisions: Record<string, string> | undefined;
    const decisionsJson = flagValue(args, '--decisions');
    if (decisionsJson) {
        try {
            decisions = JSON.parse(decisionsJson);
        } catch {
            console.error('[lutex] --decisions must be valid JSON ({"loserKey":"winnerKey",...})');
            process.exit(1);
        }
    }

    const result = cleanBibtexFile(bibPath, { root, decisions, log });
    if (result.similarPairs.length > 0 && !decisions) {
        log(`[bibtex-clean] ${result.similarPairs.length} similar-title pair(s) kept (re-run with --decisions to merge):`);
        for (const p of result.similarPairs) {
            log(`  ${p.score.toFixed(2)}  ${p.a} <-> ${p.b}`);
        }
    }
    console.log(bibPath);
}

async function main(): Promise<void> {
    const cmd = process.argv[2];
    switch (cmd) {
        case 'listen':
            await runListen(process.argv);
            break;
        case 'tex':
        case 'md':
        case 'slides':
            await runRenderer(cmd, process.argv);
            break;
        case 'slides-pdf':
            await runSlidesPdf(process.argv);
            break;
        case 'bibtex-clean':
            runBibtexClean(process.argv);
            break;
        default:
            usage();
            process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
