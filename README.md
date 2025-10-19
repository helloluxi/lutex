# LuTeX VSCode Extension

Real-time interactive LaTeX and Markdown renderers in HTML.

## Getting Started

1. Run `run.ps1` to build and install the extension
2. Open a workspace with `main.tex` (for LaTeX) or `main.md` (for Markdown)
3. Open command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
4. Run:
   - `LuTeX: Launch LuTeX Renderer with Listener` for LaTeX
   - `LuTeX: Launch Markdown Renderer with Listener` for Markdown

## Commands

| Command | Description |
|---------|-------------|
| **Launch LuTeX Renderer with Listener** | Start LaTeX preview and open in browser |
| **Launch Markdown Renderer with Listener** | Start Markdown preview and open in browser |
| **Launch Listener Only** | Start background service without opening preview |
| **Close All** | Stop all running services |
| **Jump to HTML Element** | Scroll preview to match current editor line |

## Keyboard Shortcuts

**In Renderer Window:**
- **M** - Toggle light/dark theme
- **Double-click** - Jump to corresponding line in editor

**In VS Code:**
- Run `Jump to HTML Element` command to scroll preview to current line, you may bind custom key

## How It Works

- **Editor → Preview**: Use the `Jump to HTML Element` command to scroll the preview to your current cursor position
- **Preview → Editor**: Double-click any element in the preview to jump to that line in your editor
- **Auto-sync**: Save your `.tex` or `.md` file to automatically refresh the preview
