npm run package
npm run compile:cli
for cmd in code windsurf cursor; do
    if command -v "$cmd" > /dev/null 2>&1; then
        "$cmd" --install-extension lutex-ext-0.0.1.vsix
    fi
done
