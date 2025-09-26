# LuTeX VSCode Extension

This VSCode extension provides LaTeX utilities including line jumping functionality and a built-in LaTeX renderer. It can listen to HTTP requests and jump to corresponding lines in any file in your workspace, and also host a web-based LaTeX renderer for your projects.

## Features

- **Line Jumping**: Listen to HTTP requests and jump to specific lines in LaTeX files
- **LaTeX Renderer**: Built-in web-based LaTeX renderer with navigation and theming
- **BibTeX Utilities**: Clean and normalize BibTeX files
- **Math Transformation**: Convert inline math to display math and vice versa

## Commands

### Server Management
- **LuTeX: Activate Renderer** - Start the web-based LaTeX renderer
- **LuTeX: Deactivate Renderer** - Stop the web-based LaTeX renderer
- **LuTeX: Activate Listener** - Start the line jumping listener
- **LuTeX: Deactivate Listener** - Stop the line jumping listener
- **LuTeX: Activate (Both)** - Start both renderer and listener
- **LuTeX: Deactivate (Both)** - Stop both renderer and listener

### Utility Commands
- **LuTeX: Inline to display** - Convert inline math expressions to display math
- **LuTeX: BibTeX Clean** - Clean and format BibTeX files
- **LuTeX: Tex Normalization** - Normalize LaTeX file formatting

## Status Bar

The extension shows a status indicator in the bottom-right corner of VS Code:
- 📄 icon: LaTeX renderer status (active/inactive)
- 📡 icon: Line jumping listener status (active/inactive)

Click the status bar item to quickly start/stop services.

Use with [LuTeX](https://github.com/helloluxi/lutex) project or [HTML Slides](https://github.com/helloluxi/html-slides) project.

## Using the LaTeX Renderer

1. Open a LaTeX project containing a `main.tex` file
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) to open the command palette
3. Type "LuTeX: Activate" and press Enter
4. The extension will start a local web server and open your LaTeX project in the browser
5. The renderer supports:
   - Real-time LaTeX rendering with KaTeX
   - Navigation commands (press any letter key to open command bar)
   - Theme switching (dark/light mode)
   - Cross-references and citations
   - Line jumping integration with VS Code

## Configuration

You can configure specific ports for the services in your `.vscode/settings.json` file:

```json
{
  "lutex-ext.rendererPort": 3000,
  "lutex-ext.listenerPort": 4000
}
```

If ports are not specified (or set to 0), the extension will automatically find available ports.

**Settings:**
- `lutex-ext.rendererPort`: Port for the LaTeX renderer (default: auto-detect)
- `lutex-ext.listenerPort`: Port for the line jumping listener (default: auto-detect)

## Data I/O Format

Send POST requests to `http://localhost:<port>` with JSON body:

```json
{
  "file": "filename.tex",
  "line": 42
}
```

## Building VSIX

Compile TypeScript and package extension:
```
npm run package
```
This generates `lutex-ext-<version>.vsix` which can be installed in VSCode.
