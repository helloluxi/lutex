# LuTeX Line Jumper VSCode Extension

This VSCode extension listens to HTTP requests and jumps to the corresponding line in any file in your workspace.
Use with [LuTeX](https://github.com/helloluxi/lutex) project or [HTML Slides](https://github.com/helloluxi/html-slides) project.

## Configuration

Create a `.vscode/settings.json` file in your workspace with:

```json
{
  "lutex-ext.port": "4999"
}
```

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
