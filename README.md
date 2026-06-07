# LuTeX

Real-time, interactive **LaTeX / Markdown / Slides** rendering in the browser, with two-way
file ⇄ preview navigation. Driven by **Neovim** (msgpack-RPC) and a small `lutex` CLI.

> **Ported from VSCode.** LuTeX began as a VSCode extension; that version is archived and
> **no longer maintained** at **[helloluxi/lutex-ext](https://github.com/helloluxi/lutex-ext)**.
> This repository is the standalone, editor-agnostic rework that drives Neovim instead. The `POST /jump`
> wire contract is preserved, so existing HTTP callers keep working unchanged.

## Live demos

- LaTeX renderer: TBD
- Markdown slides: [helloluxi.github.io/html-slides](https://helloluxi.github.io/html-slides)
- Markdown notes: [xlu.casa/n](https://xlu.casa/n)

## How it works

One **daemon per Neovim instance** — a single localhost HTTP+SSE server, started by the shim and bound to
that nvim's RPC socket.

- **Jump contract** — `POST /jump {file,line,action}` moves the editor to `file:line` (`jump`) or toggles a
  `[ ]` ⇄ `[x]` checkbox and saves (`check`). Other tools — a dashboard, a browser tab, an external
  daemon — drive the editor through this stable contract.
- **Preview** — the same daemon serves the rendered `.tex` / `.md` / slides HTML on its GET routes, so the
  preview shares the daemon's origin. The page double-clicks back to `POST /jump`; the daemon pushes
  scroll/refresh over SSE (`GET /event`) as you move the cursor or edit files.
- **Neovim shim** (`lutex.nvim`) — starts the daemon bound to the running nvim and provides the editor
  commands below. It spawns `node out/cli.js` by absolute path, so the nvim flow needs no global install.
- **CLI** (`lutex`) — `listen | tex | md | slides | slides-pdf | bibtex-clean`. `listen` is the daemon;
  `tex|md|slides` open the browser against a running daemon; `slides-pdf` and `bibtex-clean` run standalone.

## Install — Neovim (lazy.nvim)

```lua
{
  dir   = "~/lutex",
  build = "pnpm install && pnpm run compile",
  cmd   = { "LutexListen", "LutexStop" },
  config = function() require("lutex").setup({ port = 12023 }) end,
}
```

This lazy spec is the only thing you add to your own nvim config — and you own it, exactly like
any other plugin. LuTeX never writes to `~/.config/nvim`; its code stays in `~/lutex`. `:LutexListen`
starts the daemon bound to your current nvim; `:LutexStop` stops it. Set
`setup({ autostart = "project" })` to auto-start only in projects holding a `.lutex.json` with
`{ "autostart": true }`. Coexists with vimtex/lualine.

To avoid editing your config entirely, load it ad-hoc instead — `:set rtp+=~/lutex | lua require('lutex').start()`,
or a project-local `.nvim.lua` (nvim's `exrc`) that calls `require('lutex').start()`.

### Editor commands

| Command | Effect |
|---------|--------|
| `:LutexListen` / `:LutexStop` | Start / stop the daemon bound to this nvim |
| `:LutexMd` / `:LutexSlides` / `:LutexTex` | Open the current file's browser preview as a notebook / slides / LaTeX (starts the daemon if needed) |
| `:LutexScroll` | Scroll the browser preview to the cursor line |
| `:LutexInlineToDisplay` | Convert the visual selection (`$…$` or a `\begin{equation}` block) into a display-math block |

(`.bib` cleaning is a CLI-only tool — see `lutex bibtex-clean` below.)

These are commands, not keymaps — LuTeX binds no keys. Map the ones you use, e.g.:

```lua
vim.keymap.set("n", "<leader>lm", "<Cmd>LutexMd<CR>",           { desc = "preview as markdown notebook" })
vim.keymap.set("x", "<leader>ld", ":LutexInlineToDisplay<CR>", { desc = "inline → display math" })
vim.keymap.set("n", "<leader>ls", "<Cmd>LutexScroll<CR>",       { desc = "scroll preview to cursor" })
```

### lualine indicator (optional)

`require('lutex').status()` returns `"lutex:<port>"` while the daemon runs, `""` otherwise — drop it into a
section:

```lua
require("lualine").setup({
  sections = { lualine_x = { require("lutex").status, "filetype" } },
})
```

## CLI on the terminal

The nvim shim needs no global install, but the renderer subcommands and the standalone viewers do. Build,
then symlink the bins onto your `PATH`:

```bash
pnpm install && pnpm run compile && pnpm run compile:cli
mkdir -p ~/.local/bin
ln -sf "$(pwd)/out/cli.js"    ~/.local/bin/lutex
ln -sf "$(pwd)/out/cli/md.js" ~/.local/bin/md
```

- `lutex tex|md|slides FILE` — open a preview against a running daemon (start one with `:LutexListen`).
- `lutex slides-pdf FILE` — export slides to PDF (standalone; needs the `puppeteer` optional dep).
- `lutex bibtex-clean FILE.bib` — clean a `.bib` from the shell (standalone, no daemon).
- `md FILE.md` — no-editor markdown viewer (does not need nvim or a daemon).

## Configuration (`.lutex.json`)

Options resolve by precedence — **CLI flags > project `.lutex.json` > `~/.config/lutex/config.json` >
built-in defaults.** The project file is the nearest `.lutex.json` found at or above the working directory;
the global file also honours `$XDG_CONFIG_HOME`.

| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `port` | number | `12023` | Listener port (auto-increments if busy) |
| `nvimSocket` | string | — | nvim RPC socket to attach to (the shim passes this automatically) |
| `allowLAN` | boolean | `false` | Bind `0.0.0.0` instead of `127.0.0.1` |
| `autostart` | boolean | `false` | With `setup({ autostart = "project" })`, auto-start the daemon in this project |
| `theme` | `"light"` \| `"dark"` | `"dark"` | Preview theme |
| `katexMacros` | object | — | KaTeX macro map passed to the renderer |

Example project `.lutex.json`:

```json
{
  "port": 12030,
  "autostart": true,
  "theme": "dark",
  "katexMacros": { "\\RR": "\\mathbb{R}" }
}
```

`--port`, `--nvim`, and `--allow-lan` on `lutex listen` override the file values for that run.

## Jump contract (stable)

`POST http://127.0.0.1:<port>/jump` (also `/`), default port **12023**:

```json
{ "file": "/abs/path/file.md", "line": 42, "action": "jump" }
```

- `file` — absolute preferred; relative resolved against the editor's cwd.
- `action` — `"jump"` (default) or `"check"`.
- Response `200 "Success"`; `4xx` on bad input; connection-refused if not running.
- Optional SSE: `GET /event` (`connected` / `refresh` / `scroll` / `close`). CORS `*`, localhost only.
