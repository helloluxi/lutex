#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { MdServerCli } from './mdServer';

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: md <file.md>');
        process.exit(1);
    }

    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const server = new MdServerCli(filePath);
    const port = await server.start();
    const url = `http://localhost:${port}/?m=dark`;

    console.log(`Serving ${filePath}`);
    console.log(url);

    try {
        execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    } catch {
        // browser open failed, URL is printed above
    }

    process.on('SIGINT', () => {
        server.broadcastShutdown();
        setTimeout(() => process.exit(0), 200);
    });
}

main().catch(console.error);
