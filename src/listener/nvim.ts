import * as net from 'net';
import { attach, NeovimClient } from 'neovim';

/** Thrown when nvim cannot be reached (down, wrong socket, RPC transport error). */
export class NvimUnreachable extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NvimUnreachable';
    }
}

const JUMP_LUA = `
local fname, lnum = ...
fname = vim.fn.fnamemodify(fname, ':p')
if vim.fn.filereadable(fname) == 0 then return false end
vim.cmd('edit ' .. vim.fn.fnameescape(fname))
local count = vim.api.nvim_buf_line_count(0)
if lnum > count then lnum = count end
vim.api.nvim_win_set_cursor(0, { lnum, 0 })
vim.cmd('normal! zz')
return true
`;

const CHECK_LUA = `
local fname, lnum = ...
fname = vim.fn.fnamemodify(fname, ':p')
if vim.fn.filereadable(fname) == 0 then return false end
local bufnr = vim.fn.bufadd(fname)
vim.fn.bufload(bufnr)
local lines = vim.api.nvim_buf_get_lines(bufnr, lnum - 1, lnum, false)
if #lines == 0 then return false end
local text = lines[1]
local newtext
if text:find('[ ]', 1, true) then
  newtext = (text:gsub('%[ %]', '[x]', 1))
elseif text:find('[x]', 1, true) then
  newtext = (text:gsub('%[x%]', '[ ]', 1))
else
  return false
end
vim.api.nvim_buf_set_lines(bufnr, lnum - 1, lnum, false, { newtext })
vim.api.nvim_buf_call(bufnr, function() vim.cmd('silent write') end)
return true
`;

/**
 * Drives the already-running nvim over msgpack-RPC. Jump and check are tiny `nvim_exec_lua`
 * snippets so each action is atomic. The client is attached lazily and re-attached after any
 * transport failure, so a dead nvim surfaces as {@link NvimUnreachable} rather than a hang.
 */
export class NvimController {
    private client: NeovimClient | null = null;
    private conn: net.Socket | null = null;

    constructor(private readonly socket: string) {}

    /** Resolve the nvim socket from an explicit flag or the env nvim sets for child processes. */
    static resolveSocket(flag?: string): string {
        const sock = flag || process.env.NVIM || process.env.NVIM_LISTEN_ADDRESS;
        if (!sock) {
            throw new Error('No nvim socket found. Pass --nvim <socket> or run from inside nvim (NVIM env var).');
        }
        return sock;
    }

    async jump(file: string, line: number): Promise<boolean> {
        return (await this.exec(JUMP_LUA, [file, line])) as boolean;
    }

    async check(file: string, line: number): Promise<boolean> {
        return (await this.exec(CHECK_LUA, [file, line])) as boolean;
    }

    private connect(addr: string): net.Socket {
        const tcp = /^(.*):(\d+)$/.exec(addr);
        if (tcp && !addr.includes('/')) {
            return net.createConnection({ host: tcp[1] || '127.0.0.1', port: Number(tcp[2]) });
        }
        return net.createConnection(addr);
    }

    private ensure(): Promise<NeovimClient> {
        if (this.client) {
            return Promise.resolve(this.client);
        }
        const conn = this.connect(this.socket);
        // Persistent handlers: keep an errored/closed transport from crashing the process,
        // and drop the cache so the next request re-attaches.
        conn.on('error', () => this.drop());
        conn.on('close', () => this.drop());

        return new Promise<NeovimClient>((resolve, reject) => {
            conn.once('connect', () => {
                this.conn = conn;
                this.client = attach({ reader: conn, writer: conn });
                resolve(this.client);
            });
            conn.once('error', (err: Error) => {
                reject(new NvimUnreachable(`Cannot reach nvim at ${this.socket}: ${err.message}`));
            });
        });
    }

    private drop(): void {
        this.client = null;
        if (this.conn) {
            this.conn.destroy();
            this.conn = null;
        }
    }

    private async exec(code: string, args: unknown[]): Promise<unknown> {
        try {
            const nvim = await this.ensure();
            return await nvim.request('nvim_exec_lua', [code, args]);
        } catch (err) {
            this.drop();
            if (err instanceof NvimUnreachable) {
                throw err;
            }
            throw new NvimUnreachable(`nvim RPC failed: ${(err as Error).message}`);
        }
    }
}
