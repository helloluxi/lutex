import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Config {
    port: number;
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
    daemonPort: number;   // the daemon/listener port to open the preview against
}

const DEFAULTS = { port: 12023, allowLAN: false, theme: 'dark' };

/**
 * Resolve the effective config by precedence:
 *   CLI flags > project-local `.lutex.json` (nearest above cwd) > `~/.config/lutex/config.json` > defaults.
 * @param args  listener flags (everything after `lutex listen`): `--port N`, `--nvim SOCK`, `--allow-lan`.
 * @param cwd   directory to start the project-config walk from.
 */
export function resolveConfig(args: string[], cwd: string): Config {
    const cli = parseCliFlags(args);
    const project = readJsonConfig(findProjectConfig(cwd));
    const global = readJsonConfig(globalConfigPath());

    return {
        port: cli.port ?? project.port ?? global.port ?? DEFAULTS.port,
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

/** Walk up from `startDir` returning the first `.lutex.json` found, or null. */
function findProjectConfig(startDir: string): string | null {
    let dir = path.resolve(startDir);
    for (;;) {
        const candidate = path.join(dir, '.lutex.json');
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
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(base, 'lutex', 'config.json');
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
 * (or cwd when no file). Theme falls back to project/global config then default; `daemonPort` is the
 * listener port to open the preview against (`--port`/`--listener`, default 12023).
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
        daemonPort: cli.port ?? cli.listenerPort ?? DEFAULTS.port,
    };
}

/** Project `.lutex.json` then XDG global, merged (project wins). */
function mergeFileConfig(cwd: string): Partial<Config> {
    const project = readJsonConfig(findProjectConfig(cwd));
    const global = readJsonConfig(globalConfigPath());
    return { ...global, ...project };
}
