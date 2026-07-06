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

Two kinds of process:

- **View daemon** — one shared, long-lived process (fixed port, default **9999**, configurable) that
  renders any `.tex` / `.md` / slides file for any workspace, by absolute path. It has no notion of
  Neovim; it watches whatever it serves and pushes `refresh` over SSE (`GET /event`) on edit.
  `lutex tex|md|slides` starts it automatically if it isn't already running; `lutex reload`/`stop`
  manage its lifecycle directly.
- **Listener** — one **per Neovim instance**, started by the shim and bound to that nvim's RPC socket.
  - **Jump contract** — `POST /jump {file,line,action}` moves the editor to `file:line` (`jump`) or
    toggles a `[ ]` ⇄ `[x]` checkbox and saves (`check`). Other tools — a dashboard, a browser tab, an
    external daemon — drive the editor through this stable contract.
  - **Scroll** — `POST /scroll {file,line}` pushes a cursor-follow event over SSE (`GET /event`) to
    the browser preview.

A preview opened from Neovim carries `?o=<listenerPort>` so the page can reach *this* nvim's listener
for jump/scroll, cross-origin, alongside the view daemon's own origin; opened from a plain terminal
there's no listener, and the page is a read-only preview.

- **Neovim shim** (`lutex.nvim`) — starts the listener bound to the running nvim and provides the editor
  commands below. It spawns `node out/cli.js` by absolute path, so the nvim flow needs no global install.
- **CLI** (`lutex`) — `listen | tex | md | slides | reload | stop | slides-pdf | bibtex-clean`.
  `listen` starts the listener; `tex|md|slides` open the browser against the (auto-started) view
  daemon; `reload`/`stop` manage the view daemon directly; `slides-pdf` and `bibtex-clean` run standalone.

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
starts the listener bound to your current nvim; `:LutexStop` stops it. Set
`setup({ autostart = "project" })` to auto-start only in projects holding a `.lu/lutex.json` with
`{ "autostart": true }`. Coexists with vimtex/lualine.

To avoid editing your config entirely, load it ad-hoc instead — `:set rtp+=~/lutex | lua require('lutex').start()`,
or a project-local `.nvim.lua` (nvim's `exrc`) that calls `require('lutex').start()`.

### Editor commands

| Command | Effect |
|---------|--------|
| `:LutexListen` / `:LutexStop` | Start / stop the listener bound to this nvim |
| `:LutexMd` / `:LutexSlides` / `:LutexTex` | Open the current file's browser preview as a notebook / slides / LaTeX (starts the shared view daemon if needed) |
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

`require('lutex').status()` returns `"lutex:<port>"` while the listener runs, `""` otherwise — drop it into a
section:

```lua
require("lualine").setup({
  sections = { lualine_x = { require("lutex").status, "filetype" } },
})
```

## CLI on the terminal

The nvim shim needs no global install, but the terminal subcommands do. Build, then symlink `lutex`
onto your `PATH`:

```bash
pnpm install && pnpm run compile
mkdir -p ~/.local/bin
ln -sf "$(pwd)/out/cli.js" ~/.local/bin/lutex
```

- `lutex tex|md|slides FILE` — open a preview. Auto-starts the shared view daemon (default port
  **9999**) if it isn't already running, no editor needed. Pass `--listener PORT` to attach a
  running `:LutexListen` daemon for jump/scroll (nvim does this itself); `--dump` (slides only)
  writes static `dist/`+`index.html` next to the file.
- `lutex reload` — restart the view daemon, e.g. after a rebuild or a config change.
- `lutex stop` — stop the view daemon.
- `lutex slides-pdf FILE` — export slides to PDF (standalone; needs the `puppeteer` optional dep).
- `lutex bibtex-clean FILE.bib` — clean a `.bib` from the shell (standalone, no daemon).

## Configuration (`~/.lu/lutex.json`)

Options resolve by precedence — **CLI flags > project `.lu/lutex.json` > `~/.lu/lutex.json` >
built-in defaults.** The project file is the nearest `.lu/lutex.json` found at or above the working
directory.

| Key | Type | Default | Effect |
|-----|------|---------|--------|
| `viewPort` | number | `9999` | Shared view daemon port (`lutex tex\|md\|slides\|reload\|stop`) |
| `port` | number | `12023` | Listener port (`lutex listen`; auto-increments if busy) — unrelated to `viewPort` |
| `nvimSocket` | string | — | nvim RPC socket to attach to (the shim passes this automatically) |
| `allowLAN` | boolean | `false` | Bind `0.0.0.0` instead of `127.0.0.1` for the listener |
| `autostart` | boolean | `false` | With `setup({ autostart = "project" })`, auto-start the listener in this project |
| `theme` | `"light"` \| `"dark"` | `"dark"` | Preview theme |
| `katexMacros` | object | — | KaTeX macro map passed to the renderer |

Example project `.lu/lutex.json`:

```json
{
  "viewPort": 9999,
  "autostart": true,
  "theme": "dark",
  "katexMacros": { "\\RR": "\\mathbb{R}" }
}
```

`--port`, `--nvim`, and `--allow-lan` on `lutex listen` override the file values for that run;
`--port` on `lutex tex|md|slides|reload|stop` overrides `viewPort`.

## Jump contract (stable)

`POST http://127.0.0.1:<port>/jump` (also `/`), default port **12023**:

```json
{ "file": "/abs/path/file.md", "line": 42, "action": "jump" }
```

- `file` — absolute preferred; relative resolved against the editor's cwd.
- `action` — `"jump"` (default) or `"check"`.
- Response `200 "Success"`; `4xx` on bad input; connection-refused if not running.
- Optional SSE: `GET /event` (`connected` / `scroll`). CORS `*`, localhost only. The view daemon has
  its own, separate `GET /event` (`connected` / `refresh` / `close`) for the preview's own live-reload.
