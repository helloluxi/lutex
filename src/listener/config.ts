import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Config {
    port: number;
    viewPort?: number;
    nvimSocket?: string;
    allowLAN: boolean;
    autostart?: boolean | 'project';
    theme?: string;
    katexMacros?: Record<string, string>;
}

/** Resolved options for a renderer launcher (`lutex tex|md|slides`). */
export interface RendererOptions {
    file?: string;        // absolute path of the source file, if one was given
    root: string;         // source root advertised to the daemon (used by tex's relative fetches)
    theme: string;
    daemonPort: number;   // the view daemon's port to open the preview against
    listenerPort?: number; // nvim listener port to embed as `?o=`, if any
    dump: boolean;         // slides-only: whether to dump static assets into the served folder
    katexMacros?: Record<string, string>;
}

const DEFAULTS = { port: 12023, viewPort: 9999, allowLAN: false, theme: 'dark' };

/**
 * Resolve the effective config by precedence:
 *   CLI flags > project-local `.lu/lutex.json` (nearest above cwd) > `~/.lu/lutex.json` > defaults.
 * @param args  listener flags (everything after `lutex listen`): `--port N`, `--nvim SOCK`, `--allow-lan`.
 * @param cwd   directory to start the project-config walk from.
 */
export function resolveConfig(args: string[], cwd: string): Config {
    const cli = parseCliFlags(args);
    const project = readJsonConfig(findProjectConfig(cwd));
    const global = readJsonConfig(globalConfigPath());

    return {
        port: cli.port ?? project.port ?? global.port ?? DEFAULTS.port,
        viewPort: cli.viewPort ?? project.viewPort ?? global.viewPort,
        nvimSocket: cli.nvimSocket ?? project.nvimSocket ?? global.nvimSocket,
        allowLAN: cli.allowLAN ?? project.allowLAN ?? global.allowLAN ?? DEFAULTS.allowLAN,
        autostart: project.autostart ?? global.autostart,
        theme: project.theme ?? global.theme,
        katexMacros: project.katexMacros ?? global.katexMacros,
    };
}

interface ParsedFlags extends Partial<Config> {
    root?: string;
    listenerPort?: number;
    dump?: boolean;
}

function parseCliFlags(args: string[]): ParsedFlags {
    const out: ParsedFlags = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--port' || a === '-p') {
            out.port = toPort(args[++i]);
        } else if (a.startsWith('--port=')) {
            out.port = toPort(a.slice('--port='.length));
        } else if (a === '--nvim') {
            out.nvimSocket = args[++i];
        } else if (a.startsWith('--nvim=')) {
            out.nvimSocket = a.slice('--nvim='.length);
        } else if (a === '--allow-lan') {
            out.allowLAN = true;
        } else if (a === '--root') {
            out.root = args[++i];
        } else if (a.startsWith('--root=')) {
            out.root = a.slice('--root='.length);
        } else if (a === '--listener' || a === '-o') {
            out.listenerPort = toPort(args[++i]);
        } else if (a.startsWith('--listener=')) {
            out.listenerPort = toPort(a.slice('--listener='.length));
        } else if (a === '--dump') {
            out.dump = true;
        } else if (a === '--theme' || a === '-m') {
            out.theme = args[++i];
        } else if (a.startsWith('--theme=')) {
            out.theme = a.slice('--theme='.length);
        }
    }
    return out;
}

function toPort(value: string | undefined): number | undefined {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Walk up from `startDir` returning the first `.lu/lutex.json` found, or null. */
function findProjectConfig(startDir: string): string | null {
    let dir = path.resolve(startDir);
    for (;;) {
        const candidate = path.join(dir, '.lu', 'lutex.json');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
}

function globalConfigPath(): string {
    return path.join(os.homedir(), '.lu', 'lutex.json');
}

function readJsonConfig(file: string | null): Partial<Config> {
    if (!file || !fs.existsSync(file)) {
        return {};
    }
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const out: Partial<Config> = {};
        if (typeof raw.port === 'number') {
            out.port = raw.port;
        }
        if (typeof raw.viewPort === 'number') {
            out.viewPort = raw.viewPort;
        }
        if (typeof raw.nvimSocket === 'string') {
            out.nvimSocket = raw.nvimSocket;
        }
        if (typeof raw.allowLAN === 'boolean') {
            out.allowLAN = raw.allowLAN;
        }
        if (raw.autostart === true || raw.autostart === 'project') {
            out.autostart = raw.autostart;
        }
        if (raw.theme === 'light' || raw.theme === 'dark') {
            out.theme = raw.theme;
        }
        if (raw.katexMacros && typeof raw.katexMacros === 'object') {
            out.katexMacros = raw.katexMacros;
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * Resolve a renderer launcher's options from its args (after `lutex <kind>`) and the config files.
 * Positional `[file]` is resolved to an absolute path; `root` defaults to the file's directory
 * (or cwd when no file). `daemonPort` is the shared view daemon's port (`--port`, config `viewPort`,
 * default 9999) — unrelated to `listenerPort` (`--listener`/`-o`), which is only embedded in the
 * page URL as `?o=` for nvim jump/scroll integration and otherwise left unset.
 */
export function resolveRendererOptions(args: string[], cwd: string): RendererOptions {
    const cli = parseCliFlags(args);
    const fileConfig = mergeFileConfig(cwd);
    const positional = args.find(a => !a.startsWith('-'));

    const file = positional ? path.resolve(cwd, positional) : undefined;
    const root = cli.root
        ? path.resolve(cwd, cli.root)
        : (file ? path.dirname(file) : cwd);

    return {
        file,
        root,
        theme: cli.theme ?? fileConfig.theme ?? DEFAULTS.theme,
        daemonPort: cli.port ?? fileConfig.viewPort ?? DEFAULTS.viewPort,
        listenerPort: cli.listenerPort,
        dump: cli.dump ?? false,
        katexMacros: fileConfig.katexMacros,
    };
}

/** Project `.lu/lutex.json` then global `~/.lu/lutex.json`, merged (project wins). */
function mergeFileConfig(cwd: string): Partial<Config> {
    const project = readJsonConfig(findProjectConfig(cwd));
    const global = readJsonConfig(globalConfigPath());
    return { ...global, ...project };
}
