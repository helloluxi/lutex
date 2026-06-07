import * as fs from 'fs';
import * as path from 'path';
import { toJSON, toBibtex, BibtexEntry } from './bibtexParser';

/** A pair of entries whose titles are similar enough to be candidate duplicates. */
export interface SimilarPair {
    a: string;        // citation key of the first entry
    b: string;        // citation key of the second entry
    titleA: string;
    titleB: string;
    score: number;    // Jaccard similarity in [0, 1]
}

export interface CleanOptions {
    /** Directory scanned recursively for `.tex` files (citation pruning + key replacement). Default: the `.bib`'s directory. */
    root?: string;
    /**
     * Merge decisions for similar-title pairs, keyed `loserKey -> winnerKey`: the loser entry is
     * removed and its citations in `.tex` files are rewritten to the winner. Pairs with no decision
     * are kept as-is (the non-interactive CLI default); supply this via `--decisions JSON`.
     */
    decisions?: Record<string, string>;
    log?: (msg: string) => void;
}

export interface CleanResult {
    originalCount: number;
    finalCount: number;
    removedCount: number;
    duplicates: number;
    abstractsRemoved: number;
    monthsConverted: number;
    unusedRemoved: number;
    texFiles: number;
    texReplacements: number;
    similarPairs: SimilarPair[];
    backupPath: string;
}

const MONTH_MAP: { [key: string]: string } = {
    january: '1', jan: '1',
    february: '2', feb: '2',
    march: '3', mar: '3',
    april: '4', apr: '4',
    may: '5',
    june: '6', jun: '6',
    july: '7', jul: '7',
    august: '8', aug: '8',
    september: '9', sep: '9', sept: '9',
    october: '10', oct: '10',
    november: '11', nov: '11',
    december: '12', dec: '12',
};

function dedupeEntries(entries: BibtexEntry[]): { kept: BibtexEntry[]; removed: BibtexEntry[] } {
    const seen = new Map<string, BibtexEntry>();
    const removed: BibtexEntry[] = [];
    for (const entry of entries) {
        if (!entry.citationKey) {
            continue; // entries without a key are dropped (PREAMBLE/COMMENT carry no citationKey)
        }
        if (!seen.has(entry.citationKey)) {
            seen.set(entry.citationKey, entry);
        } else {
            removed.push(entry);
        }
    }
    return { kept: Array.from(seen.values()), removed };
}

function normalizeTitle(title: string): string {
    return (title || '')
        .toLowerCase()
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1') // unwrap LaTeX commands
        .replace(/[^a-z0-9\s]/g, ' ')             // keep alphanumerics and spaces
        .replace(/\s+/g, ' ')
        .trim();
}

function calculateSimilarity(titleA: string, titleB: string): number {
    const a = normalizeTitle(titleA);
    const b = normalizeTitle(titleB);
    if (!a || !b) {
        return 0;
    }
    if (a === b) {
        return 1;
    }
    // Jaccard over words longer than two characters.
    const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

/** All entry pairs whose titles score at or above `threshold`, highest first. */
export function findSimilarTitles(entries: BibtexEntry[], threshold = 0.8): SimilarPair[] {
    const pairs: SimilarPair[] = [];
    const withTitles = entries.filter(e => e.citationKey && e.entryTags?.title);
    for (let i = 0; i < withTitles.length; i++) {
        for (let j = i + 1; j < withTitles.length; j++) {
            const entryA = withTitles[i];
            const entryB = withTitles[j];
            const titleA = entryA.entryTags!.title;
            const titleB = entryB.entryTags!.title;
            const score = calculateSimilarity(titleA, titleB);
            if (score >= threshold) {
                pairs.push({ a: entryA.citationKey!, b: entryB.citationKey!, titleA, titleB, score });
            }
        }
    }
    return pairs.sort((x, y) => y.score - x.score);
}

/** Parse + dedupe a `.bib` file and report similar-title pairs without writing anything. */
export function findSimilarPairs(bibPath: string, threshold = 0.8): SimilarPair[] {
    const entries = toJSON(fs.readFileSync(bibPath, 'utf8'));
    const { kept } = dedupeEntries(entries);
    return findSimilarTitles(kept, threshold);
}

function cleanAndNormalizeEntries(entries: BibtexEntry[]): { cleaned: BibtexEntry[]; abstractsRemoved: number; monthsConverted: number } {
    let abstractsRemoved = 0;
    let monthsConverted = 0;
    const cleaned = entries.map(entry => {
        const out: BibtexEntry = {
            ...entry,
            entryTags: entry.entryTags ? { ...entry.entryTags } : undefined,
        };
        if (out.entryTags) {
            if (out.entryTags.abstract) {
                delete out.entryTags.abstract;
                abstractsRemoved++;
            }
            if (out.entryTags.month) {
                const m = out.entryTags.month.toLowerCase().trim();
                if (MONTH_MAP[m]) {
                    out.entryTags.month = MONTH_MAP[m];
                    monthsConverted++;
                }
            }
        }
        return out;
    });
    return { cleaned, abstractsRemoved, monthsConverted };
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Recursively collect `.tex` files under `root` (skipping `node_modules` and dot-directories). */
export function findTexFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // unreadable directory — skip
        }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name !== 'node_modules' && !ent.name.startsWith('.')) {
                    walk(full);
                }
            } else if (ent.isFile() && ent.name.endsWith('.tex')) {
                out.push(full);
            }
        }
    };
    walk(root);
    return out;
}

function pruneUnusedEntries(entries: BibtexEntry[], texFiles: string[]): { kept: BibtexEntry[]; pruned: BibtexEntry[] } {
    let corpus = '';
    for (const f of texFiles) {
        try {
            corpus += fs.readFileSync(f, 'utf8') + '\n';
        } catch {
            // unreadable file — ignore
        }
    }
    const kept: BibtexEntry[] = [];
    const pruned: BibtexEntry[] = [];
    for (const entry of entries) {
        if (!entry.citationKey) {
            kept.push(entry);
        } else if (corpus.includes(entry.citationKey)) {
            kept.push(entry);
        } else {
            pruned.push(entry);
        }
    }
    return { kept, pruned };
}

/** Rewrite `\cite`-family keys in every `.tex` file per `replacements` (loser -> winner). Returns the count applied. */
function applyReplacementsToTexFiles(replacements: Map<string, string>, texFiles: string[], log: (m: string) => void): number {
    if (replacements.size === 0) {
        return 0;
    }
    let total = 0;
    for (const texFile of texFiles) {
        let content: string;
        try {
            content = fs.readFileSync(texFile, 'utf8');
        } catch {
            continue;
        }
        let fileReplacements = 0;
        for (const [oldKey, newKey] of replacements) {
            const patterns = [
                new RegExp(`\\\\cite\\{${escapeRegex(oldKey)}\\}`, 'g'),
                new RegExp(`\\\\citep\\{${escapeRegex(oldKey)}\\}`, 'g'),
                new RegExp(`\\\\citet\\{${escapeRegex(oldKey)}\\}`, 'g'),
                new RegExp(`\\\\cite\\[([^\\]]*)\\]\\{${escapeRegex(oldKey)}\\}`, 'g'),
                new RegExp(`(\\\\cite[pt]?(?:\\[[^\\]]*\\])?\\{[^}]*?)\\b${escapeRegex(oldKey)}\\b([^}]*\\})`, 'g'),
            ];
            for (const pattern of patterns) {
                const matches = content.match(pattern);
                if (matches) {
                    content = content.replace(pattern, m => m.replace(oldKey, newKey));
                    fileReplacements += matches.length;
                }
            }
        }
        if (fileReplacements > 0) {
            fs.writeFileSync(texFile, content, 'utf8');
            log(`[bibtex-clean] ${path.basename(texFile)}: ${fileReplacements} citation replacement(s)`);
            total += fileReplacements;
        }
    }
    return total;
}

/**
 * Clean a `.bib` file in place: dedupe by key, apply any merge `decisions` (removing the loser and
 * rewriting its `.tex` citations), strip `abstract` fields, normalize month names to integers, and
 * prune entries cited nowhere in the project's `.tex` files. The original is copied to `<file>.backup`
 * before the cleaned, human-readable output is written.
 */
export function cleanBibtexFile(bibPath: string, opts: CleanOptions = {}): CleanResult {
    const log = opts.log ?? (() => {});
    const root = opts.root ?? path.dirname(bibPath);
    const decisions = opts.decisions ?? {};

    const entries = toJSON(fs.readFileSync(bibPath, 'utf8'));
    const originalCount = entries.length;

    const { kept: deduped, removed: duplicates } = dedupeEntries(entries);
    log(`[bibtex-clean] parsed ${originalCount} entries, removed ${duplicates.length} duplicate(s)`);

    const similarPairs = findSimilarTitles(deduped);
    const texFiles = findTexFiles(root);

    // Apply merge decisions: each `loser -> winner` removes the loser and redirects its citations.
    const replacements = new Map<string, string>();
    const toRemove = new Set<string>();
    for (const [loser, winner] of Object.entries(decisions)) {
        if (loser && winner && loser !== winner) {
            replacements.set(loser, winner);
            toRemove.add(loser);
        }
    }
    let working = toRemove.size > 0 ? deduped.filter(e => !toRemove.has(e.citationKey || '')) : deduped;
    const texReplacements = applyReplacementsToTexFiles(replacements, texFiles, log);
    if (toRemove.size > 0) {
        log(`[bibtex-clean] merged ${toRemove.size} similar entr(ies); ${texReplacements} citation(s) rewritten`);
    }

    const { cleaned, abstractsRemoved, monthsConverted } = cleanAndNormalizeEntries(working);
    working = cleaned;
    log(`[bibtex-clean] stripped ${abstractsRemoved} abstract(s), normalized ${monthsConverted} month(s)`);

    let unusedRemoved = 0;
    if (texFiles.length > 0) {
        const { kept, pruned } = pruneUnusedEntries(working, texFiles);
        working = kept;
        unusedRemoved = pruned.length;
        log(`[bibtex-clean] pruned ${unusedRemoved} unused entr(ies) against ${texFiles.length} .tex file(s)`);
    } else {
        log('[bibtex-clean] no .tex files found under root; skipping unused-entry pruning');
    }

    const backupPath = bibPath + '.backup';
    fs.copyFileSync(bibPath, backupPath);
    fs.writeFileSync(bibPath, toBibtex(working, false), 'utf8');

    const finalCount = working.length;
    log(`[bibtex-clean] done: ${originalCount} -> ${finalCount} entries (backup: ${path.basename(backupPath)})`);

    return {
        originalCount,
        finalCount,
        removedCount: originalCount - finalCount,
        duplicates: duplicates.length,
        abstractsRemoved,
        monthsConverted,
        unusedRemoved,
        texFiles: texFiles.length,
        texReplacements,
        similarPairs,
        backupPath,
    };
}
