# LuTeX dev tasks. Run `just` to list, `just build` for the common path.

# Show available recipes
default:
    @just --list

# Install JS dependencies (pnpm)
deps:
    pnpm install

# Compile the daemon + browser renderer assets (what the nvim plugin loads)
build: deps
    pnpm run compile

# Compile the standalone CLI bins (out/cli/md.js)
cli:
    pnpm run compile:cli

# Incremental rebuild of the daemon on save (tsc -watch)
watch:
    pnpm run watch

# Remove build output (out/, res/dist/)
clean:
    pnpm run clean

# Symlink the `lutex` and `md` bins onto ~/.local/bin (builds first)
link: build cli
    mkdir -p ~/.local/bin
    chmod +x out/cli.js out/cli/md.js
    ln -sf "{{justfile_directory()}}/out/cli.js" ~/.local/bin/lutex
    ln -sf "{{justfile_directory()}}/out/cli/md.js" ~/.local/bin/md
    @echo "linked: lutex, md -> ~/.local/bin"
