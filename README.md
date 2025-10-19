# LuTeX VSCode Extension

Xi Lu's Real-time interactive LaTeX and Markdown HTML renderers.

## Features

- **LuTeX Renderer**: Real-time LaTeX rendering with interactive two-way navigation
- **Markdown Renderer**: Real-time Markdown rendering with interactive features
- **Listener**: Enables two-way communication between VS Code and renderers

## Usage

### Quick Start

1. Run `run.ps1` to build and install the extension
2. Open the command palette (Ctrl+Shift+P / Cmd+Shift+P)
3. Choose one of the following commands:
   - **LuTeX: Launch LuTeX Renderer with Listener** - For LaTeX files (requires `main.tex` in workspace)
   - **LuTeX: Launch Markdown Renderer with Listener** - For Markdown files (requires `main.md` in workspace)
   - **LuTeX: Launch Listener Only** - Start listener without renderer
   - **LuTeX: Close All** - Stop all running services

### Commands

- **Launch LuTeX Renderer with Listener**: Starts the LaTeX renderer and listener, opens browser
- **Launch Markdown Renderer with Listener**: Starts the Markdown renderer and listener, opens browser
- **Launch Listener Only**: Starts only the listener server for external renderer integration
- **Close All**: Stops all running renderers and listener
- **Jump to HTML Element**: Jump to the HTML element corresponding to the current line in VS Code

### Interactive Features

- **Editor to Renderer**: Run **LuTeX: Jump to HTML Element** to scroll the renderer to the current line
- **Renderer to Editor**: Double-click any HTML element in the renderer to jump to the corresponding line in VS Code
- **Auto-refresh**: The renderer automatically refreshes when you save `.tex` or `.md` files

### Status Bar

Click the LuTeX icon in the status bar to quickly access all commands and see which services are running.

### Custom Keybindings

You may set custom keybindings for any command in VS Code's keyboard shortcuts settings.
