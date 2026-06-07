import * as fs from 'fs';
import * as path from 'path';

const WATCH_EXT = ['.md', '.tex', '.bib'];

/**
 * Watches one or more source roots and fires `onChange(absFile)` (debounced) when a renderer source
 * file is edited. Owned by the daemon, which relays the change as an SSE `refresh` to the browser.
 */
export class RootWatcher {
    private readonly watchers = new Map<string, fs.FSWatcher>();
    private timer: NodeJS.Timeout | undefined;
    private pending: string | undefined;

    constructor(
        private readonly onChange: (file: string) => void,
        private readonly log: (msg: string) => void,
    ) {}

    watch(dir: string): void {
        const resolved = path.resolve(dir);
        if (this.watchers.has(resolved)) {
            return;
        }
        try {
            const watcher = fs.watch(resolved, { recursive: true }, (_event, filename) => {
                if (!filename) {
                    return;
                }
                const name = filename.toString();
                if (!WATCH_EXT.includes(path.extname(name).toLowerCase())) {
                    return;
                }
                this.pending = path.resolve(resolved, name);
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.onChange(this.pending!), 120);
            });
            this.watchers.set(resolved, watcher);
        } catch (err) {
            this.log(`[watch] cannot watch ${resolved}: ${err}`);
        }
    }

    close(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
        clearTimeout(this.timer);
    }
}
