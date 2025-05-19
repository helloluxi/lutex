# LuTeX Line Jumper VSCode Extension

This VSCode extension listens to HTTP requests on localhost:4999 and jumps to the corresponding line in your main.tex file.

## Features

- Listens on port 4999 for HTTP POST requests
- Automatically finds and opens main.tex in your workspace
- Jumps to the specified line number when received
- Centers the view on the target line

## Installation

### Method 1: Development Mode
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press F5 in VSCode to start debugging the extension

### Method 2: Using Unpacked Extension
1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Run `npm run package` to create a VSIX file
5. In your target VSCode project:
   - Open the Command Palette (Ctrl+Shift+P)
   - Type "Install from VSIX"
   - Select the generated .vsix file from the `lutex-ext` directory
   - Reload VSCode when prompted

## Usage

1. Make sure you have a main.tex file in your workspace
2. The extension will automatically start listening on port 4999 when VSCode starts
3. Send a line number via HTTP POST request to jump to that line in main.tex

### Testing the Extension

#### Using JavaScript:
```javascript
// Send a line number using fetch
fetch('http://localhost:4999', {
    method: 'POST',
    headers: {
        'Content-Type': 'text/plain',
    },
    body: '42'  // Replace with your line number
})
.then(response => response.text())
.then(result => console.log(result))
.catch(error => console.error('Error:', error));
```

#### Using curl:
```bash
curl -X POST -H "Content-Type: text/plain" -d "42" http://localhost:4999
```

The server will respond with:
- 200 OK if the line jump was successful
- 400 Bad Request if the line number is invalid
- 405 Method Not Allowed if you use a method other than POST
- 500 Internal Server Error if something goes wrong

## Development

- `npm run compile` - Compile the extension
- `npm run watch` - Watch for changes and recompile
- `npm run lint` - Run ESLint
- `npm run test` - Run tests
- `npm run package` - Create a VSIX package

## Requirements

- VSCode 1.60.0 or higher
- Node.js and npm
- A LuTeX project with a `main.tex` file 