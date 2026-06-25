#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { execSync, spawn } from 'child_process';
import { MdServerCli, MD_DAEMON_PORT, MD_VERSION } from './mdServer';

/** GET a daemon endpoint, resolving null if it is unreachable within the timeout. */
function probe(pathname: string, timeoutMs = 500): Promise<{ status: number; body: string } | null> {
    return new Promise((resolve) => {
        const req = http.get({ host: 'localhost', port: MD_DAEMON_PORT, path: pathname, timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/** Run the long-lived daemon in the foreground (the process spawned by `ensureDaemon`). */
async function runDaemon(): Promise<void> {
    const server = new MdServerCli();
    try {
        await server.start(MD_DAEMON_PORT);
    } catch {
        // Lost the race — another daemon already owns the port. Nothing to do.
        process.exit(0);
    }
    console.error(`md daemon ${MD_VERSION} on http://localhost:${MD_DAEMON_PORT}`);
    process.on('SIGINT', () => server.stop());
    process.on('SIGTERM', () => server.stop());
}

/** Ensure a daemon of the current version is listening, spawning (or replacing) one if needed. */
async function ensureDaemon(): Promise<void> {
    const health = await probe('/health');
    if (health?.status === 200) {
        try {
            const { version } = JSON.parse(health.body);
            if (version === MD_VERSION) { return; }
        } catch { /* malformed health — treat as stale */ }
        // A stale daemon is running an older build; replace it.
        await probe('/quit');
        for (let i = 0; i < 30 && await probe('/health'); i++) {
            await new Promise(r => setTimeout(r, 100));
        }
    }

    const child = spawn(process.execPath, [__filename, '--daemon'], { detached: true, stdio: 'ignore' });
    child.unref();

    for (let i = 0; i < 50; i++) {
        if ((await probe('/health'))?.status === 200) { return; }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('md daemon failed to start');
}

async function stopDaemon(): Promise<void> {
    if (await probe('/quit')) { console.log('md daemon stopped'); }
    else { console.log('md daemon not running'); }
}

function usage(): void {
    console.error(`Usage: md <file.md>

Open a markdown file in the browser, rendered by a shared daemon on port ${MD_DAEMON_PORT}.
The daemon starts on first use and stays running, so repeat opens reuse one process;
the served file live-reloads on edit.

Options:
  --stop      Stop the running daemon
  -h, --help  Show this help`);
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--daemon')) { await runDaemon(); return; }
    if (args.includes('--stop')) { await stopDaemon(); return; }
    if (args.includes('-h') || args.includes('--help')) { usage(); return; }

    if (args.length === 0) {
        usage();
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    await ensureDaemon();
    const url = `http://localhost:${MD_DAEMON_PORT}/?f=${encodeURIComponent(filePath)}&m=dark`;
    console.log(url);

    try {
        execSync(`open "${url}"`, { stdio: 'ignore' });
    } catch {
        // browser open failed, URL is printed above
    }
}

main().catch(err => { console.error(err); process.exit(1); });
