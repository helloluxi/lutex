import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { toJSON, toBibtex, BibtexEntry } from './bibtexParser';

interface SimilarPair {
    a: string;
    b: string;
    entryA: BibtexEntry;
    entryB: BibtexEntry;
    score: number;
}

export function registerBibtexCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
    const bibtexCleanCommand = vscode.commands.registerCommand('lutex-ext.bibtexClean', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor found');
            return;
        }

        const document = editor.document;
        if (!document.fileName.endsWith('.bib')) {
            vscode.window.showWarningMessage('Current file must be a .bib file');
            return;
        }

        try {
            await cleanBibtexFile(document.fileName, outputChannel);
        } catch (error) {
            const errorMsg = `Error cleaning BibTeX file: ${error}`;
            outputChannel.appendLine(`[LuTeX] ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
        }
    });

    context.subscriptions.push(bibtexCleanCommand);
}

async function cleanBibtexFile(bibFilePath: string, outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine(`[LuTeX] Starting BibTeX clean for: ${path.basename(bibFilePath)}`);

    // Read and parse the BibTeX file
    const bibContent = fs.readFileSync(bibFilePath, 'utf8');
    const entries = toJSON(bibContent);
    const originalCount = entries.length;
    
    outputChannel.appendLine(`[LuTeX] Parsed ${originalCount} entries`);

    // 1. Deduplicate by citation key
    const { kept: deduped, removed: duplicates } = dedupeEntries(entries);
    outputChannel.appendLine(`[LuTeX] Removed ${duplicates.length} duplicate entries`);

    // 2. Find similar titles
    const similarPairs = findSimilarTitles(deduped);
    let finalEntries = deduped;
    
    if (similarPairs.length > 0) {
        outputChannel.appendLine(`[LuTeX] Found ${similarPairs.length} pairs with similar titles`);
        
        const { replacements, toRemove } = await handleSimilarTitles(similarPairs, outputChannel);
        
        // Remove entries marked for removal
        finalEntries = deduped.filter(entry => !toRemove.has(entry.citationKey || ''));
        outputChannel.appendLine(`[LuTeX] Removed ${toRemove.size} similar entries`);
        
        // Apply replacements to .tex files
        if (replacements.size > 0) {
            await applyReplacementsToTexFiles(replacements, outputChannel);
        }
    }

    // 3. Find unused entries (if we have tex files)
    const texFiles = await findTexFiles();
    if (texFiles.length > 0) {
        const { kept: pruned, pruned: unused } = await pruneUnusedEntries(finalEntries, texFiles);
        finalEntries = pruned;
        outputChannel.appendLine(`[LuTeX] Removed ${unused.length} unused entries from ${texFiles.length} .tex files`);
    } else {
        outputChannel.appendLine(`[LuTeX] No .tex files found in workspace, skipping unused entry removal`);
    }

    // 4. Create backup and write cleaned file
    const backupPath = bibFilePath + '.backup';
    fs.copyFileSync(bibFilePath, backupPath);
    outputChannel.appendLine(`[LuTeX] Created backup: ${path.basename(backupPath)}`);

    const cleanedContent = toBibtex(finalEntries, true);
    fs.writeFileSync(bibFilePath, cleanedContent, 'utf8');

    const finalCount = finalEntries.length;
    const removedCount = originalCount - finalCount;
    
    outputChannel.appendLine(`[LuTeX] Cleaning complete! Original: ${originalCount}, Final: ${finalCount}, Removed: ${removedCount}`);
    vscode.window.showInformationMessage(
        `BibTeX cleaning complete! Removed ${removedCount} entries (${duplicates.length} duplicates, ${similarPairs.length} similar, ${originalCount - finalCount - duplicates.length - similarPairs.length} unused)`
    );
}

function dedupeEntries(entries: BibtexEntry[]): { kept: BibtexEntry[], removed: BibtexEntry[] } {
    const seen = new Map<string, BibtexEntry>();
    const removed: BibtexEntry[] = [];
    
    for (const entry of entries) {
        if (!entry.citationKey) {
            continue; // Keep entries without citation keys as-is
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
        .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1') // Remove LaTeX commands
        .replace(/[^a-z0-9\s]/g, ' ') // Keep only alphanumeric and spaces
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}

function calculateSimilarity(titleA: string, titleB: string): number {
    const a = normalizeTitle(titleA);
    const b = normalizeTitle(titleB);
    
    if (!a || !b) return 0;
    if (a === b) return 1;
    
    // Simple Jaccard similarity based on words
    const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
    
    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
}

function findSimilarTitles(entries: BibtexEntry[], threshold: number = 0.8): SimilarPair[] {
    const pairs: SimilarPair[] = [];
    const entriesWithTitles = entries.filter(e => e.citationKey && e.entryTags?.title);
    
    for (let i = 0; i < entriesWithTitles.length; i++) {
        for (let j = i + 1; j < entriesWithTitles.length; j++) {
            const entryA = entriesWithTitles[i];
            const entryB = entriesWithTitles[j];
            
            const titleA = entryA.entryTags!.title;
            const titleB = entryB.entryTags!.title;
            
            const score = calculateSimilarity(titleA, titleB);
            
            if (score >= threshold) {
                pairs.push({
                    a: entryA.citationKey!,
                    b: entryB.citationKey!,
                    entryA,
                    entryB,
                    score
                });
            }
        }
    }
    
    return pairs.sort((a, b) => b.score - a.score);
}

async function handleSimilarTitles(similarPairs: SimilarPair[], outputChannel: vscode.OutputChannel): Promise<{ replacements: Map<string, string>, toRemove: Set<string> }> {
    const replacements = new Map<string, string>();
    const toRemove = new Set<string>();
    
    for (const pair of similarPairs) {
        const choice = await vscode.window.showQuickPick([
            {
                label: `Keep "${pair.a}"`,
                description: `Remove "${pair.b}" and replace references`,
                choice: 'first'
            },
            {
                label: `Keep "${pair.b}"`,
                description: `Remove "${pair.a}" and replace references`,
                choice: 'second'
            },
            {
                label: 'Keep both entries',
                description: 'No changes will be made',
                choice: 'both'
            }
        ], {
            placeHolder: `Similar titles found (${pair.score.toFixed(2)} similarity)`,
            ignoreFocusOut: true
        });
        
        if (!choice) {
            continue; // User cancelled
        }
        
        switch (choice.choice) {
            case 'first':
                replacements.set(pair.b, pair.a);
                toRemove.add(pair.b);
                outputChannel.appendLine(`[LuTeX] Will replace ${pair.b} → ${pair.a}`);
                break;
            case 'second':
                replacements.set(pair.a, pair.b);
                toRemove.add(pair.a);
                outputChannel.appendLine(`[LuTeX] Will replace ${pair.a} → ${pair.b}`);
                break;
            case 'both':
                outputChannel.appendLine(`[LuTeX] Keeping both ${pair.a} and ${pair.b}`);
                break;
        }
    }
    
    return { replacements, toRemove };
}

async function findTexFiles(): Promise<string[]> {
    if (!vscode.workspace.workspaceFolders) {
        return [];
    }
    
    const texFiles: string[] = [];
    
    for (const folder of vscode.workspace.workspaceFolders) {
        const pattern = new vscode.RelativePattern(folder, '**/*.tex');
        const files = await vscode.workspace.findFiles(pattern);
        texFiles.push(...files.map(uri => uri.fsPath));
    }
    
    return texFiles;
}

async function applyReplacementsToTexFiles(replacements: Map<string, string>, outputChannel: vscode.OutputChannel): Promise<void> {
    const texFiles = await findTexFiles();
    if (texFiles.length === 0) return;
    
    outputChannel.appendLine(`[LuTeX] Applying ${replacements.size} replacements to ${texFiles.length} .tex files`);
    
    let totalReplacements = 0;
    
    for (const texFile of texFiles) {
        try {
            let content = fs.readFileSync(texFile, 'utf8');
            let fileReplacements = 0;
            
            for (const [oldKey, newKey] of replacements) {
                // Create regex patterns for different citation formats
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
                        content = content.replace(pattern, (match) => match.replace(oldKey, newKey));
                        fileReplacements += matches.length;
                    }
                }
            }
            
            if (fileReplacements > 0) {
                fs.writeFileSync(texFile, content, 'utf8');
                outputChannel.appendLine(`[LuTeX] ${path.basename(texFile)}: ${fileReplacements} replacements`);
                totalReplacements += fileReplacements;
            }
        } catch (error) {
            outputChannel.appendLine(`[LuTeX] Error processing ${texFile}: ${error}`);
        }
    }
    
    outputChannel.appendLine(`[LuTeX] Total citation replacements: ${totalReplacements}`);
}

async function pruneUnusedEntries(entries: BibtexEntry[], texFiles: string[]): Promise<{ kept: BibtexEntry[], pruned: BibtexEntry[] }> {
    // Build corpus of all tex content
    let corpus = '';
    for (const texFile of texFiles) {
        try {
            corpus += fs.readFileSync(texFile, 'utf8') + '\n';
        } catch (error) {
            // Ignore file read errors
        }
    }
    
    const kept: BibtexEntry[] = [];
    const pruned: BibtexEntry[] = [];
    
    for (const entry of entries) {
        if (!entry.citationKey) {
            kept.push(entry); // Keep entries without citation keys
            continue;
        }
        
        // Check if citation key appears in any tex file
        if (corpus.includes(entry.citationKey)) {
            kept.push(entry);
        } else {
            pruned.push(entry);
        }
    }
    
    return { kept, pruned };
}

function escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}