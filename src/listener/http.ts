import * as http from 'http';

/**
 * Vscode-free HTTP helpers shared by the listener (and, later, the renderers).
 */

/**
 * Find an available port starting from `startPort`, trying up to 100 consecutive ports.
 * @throws Error if no available port found after 100 attempts.
 */
export function findAvailablePort(hostname: string = 'localhost', startPort: number = 12023): Promise<number> {
    return new Promise((resolve, reject) => {
        const maxAttempts = 100;
        let attemptCount = 0;

        const tryPort = (port: number) => {
            if (attemptCount >= maxAttempts) {
                reject(new Error(`No available port found after ${maxAttempts} attempts (tried ports ${startPort}-${startPort + maxAttempts - 1})`));
                return;
            }
            attemptCount++;
            const testServer = http.createServer();
            testServer.listen(port, hostname, () => {
                testServer.close(() => resolve(port));
            }).on('error', () => tryPort(port + 1));
        };

        tryPort(startPort);
    });
}

/** Coerce a request `line` field to a positive-capable number, or null if not numeric. */
export function parseLineNumber(line: unknown): number | null {
    if (typeof line === 'number') {
        return line;
    }
    if (typeof line === 'string') {
        const n = parseInt(line, 10);
        return Number.isNaN(n) ? null : n;
    }
    return null;
}

/** Add the permissive CORS headers every listener response carries. */
export function addCorsHeaders(res: http.ServerResponse, methods: string = 'GET, POST, OPTIONS'): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** Reply to a CORS preflight (OPTIONS) request. */
export function handleOptionsRequest(res: http.ServerResponse): void {
    res.writeHead(204);
    res.end();
}
