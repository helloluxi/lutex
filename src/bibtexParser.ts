// TypeScript port of bibtexParse.js with improved type safety

interface BibtexEntry {
    citationKey?: string;
    entryType: string;
    entryTags?: { [key: string]: string };
    entry?: string;
}

class BibtexParser {
    private months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    private notKey = [',', '{', '}', ' ', '='];
    private pos = 0;
    private input = "";
    private entries: BibtexEntry[] = [];
    private currentEntry: BibtexEntry = { entryType: "" };

    setInput(input: string): void {
        this.input = input;
        this.pos = 0;
        this.entries = [];
    }

    getEntries(): BibtexEntry[] {
        return this.entries;
    }

    private isWhitespace(s: string): boolean {
        return (s === ' ' || s === '\r' || s === '\t' || s === '\n');
    }

    private match(s: string, canCommentOut: boolean = true): void {
        this.skipWhitespace(canCommentOut);
        if (this.input.substring(this.pos, this.pos + s.length) === s) {
            this.pos += s.length;
        } else {
            throw new TypeError(`Token mismatch: expected ${s}, found ${this.input.substring(this.pos)}`);
        }
        this.skipWhitespace(canCommentOut);
    }

    private tryMatch(s: string, canCommentOut: boolean = true): boolean {
        this.skipWhitespace(canCommentOut);
        if (this.input.substring(this.pos, this.pos + s.length) === s) {
            return true;
        }
        return false;
    }

    private matchAt(): boolean {
        while (this.input.length > this.pos && this.input[this.pos] !== '@') {
            this.pos++;
        }
        return this.input[this.pos] === '@';
    }

    private skipWhitespace(canCommentOut: boolean): void {
        while (this.pos < this.input.length && this.isWhitespace(this.input[this.pos])) {
            this.pos++;
        }
        if (this.pos < this.input.length && this.input[this.pos] === "%" && canCommentOut) {
            while (this.pos < this.input.length && this.input[this.pos] !== "\n") {
                this.pos++;
            }
            this.skipWhitespace(canCommentOut);
        }
    }

    private valueBraces(): string {
        let bracecount = 0;
        this.match("{", false);
        const start = this.pos;
        let escaped = false;
        
        while (true) {
            if (this.pos >= this.input.length - 1) {
                throw new TypeError("Unterminated value: value_braces");
            }
            
            if (!escaped) {
                if (this.input[this.pos] === '}') {
                    if (bracecount > 0) {
                        bracecount--;
                    } else {
                        const end = this.pos;
                        this.match("}", false);
                        return this.input.substring(start, end);
                    }
                } else if (this.input[this.pos] === '{') {
                    bracecount++;
                }
            }
            
            escaped = this.input[this.pos] === '\\' && !escaped;
            this.pos++;
        }
    }

    private valueQuotes(): string {
        this.match('"', false);
        const start = this.pos;
        let escaped = false;
        
        while (true) {
            if (this.pos >= this.input.length - 1) {
                throw new TypeError("Unterminated value: value_quotes");
            }
            
            if (!escaped && this.input[this.pos] === '"') {
                const end = this.pos;
                this.match('"', false);
                return this.input.substring(start, end);
            }
            
            escaped = this.input[this.pos] === '\\' && !escaped;
            this.pos++;
        }
    }

    private valueComment(): string {
        let str = '';
        let brcktCnt = 0;
        
        while (!(this.tryMatch("}", false) && brcktCnt === 0)) {
            if (this.pos >= this.input.length - 1) {
                throw new TypeError("Unterminated value: value_comment");
            }
            
            str += this.input[this.pos];
            if (this.input[this.pos] === '{') brcktCnt++;
            if (this.input[this.pos] === '}') brcktCnt--;
            this.pos++;
        }
        
        return str;
    }

    private singleValue(): string {
        if (this.tryMatch("{")) {
            return this.valueBraces();
        } else if (this.tryMatch('"')) {
            return this.valueQuotes();
        } else {
            const k = this.key();
            if (k.match("^[0-9]+$")) {
                return k;
            } else if (this.months.indexOf(k.toLowerCase()) >= 0) {
                return k.toLowerCase();
            } else {
                throw new Error(`Value expected: ${k}`);
            }
        }
    }

    private value(): string {
        const values: string[] = [];
        values.push(this.singleValue());
        
        while (this.tryMatch("#")) {
            this.match("#");
            values.push(this.singleValue());
        }
        
        return values.join("");
    }

    private key(optional: boolean = false): string {
        const start = this.pos;
        
        while (true) {
            if (this.pos >= this.input.length) {
                throw new TypeError("Runaway key");
            }
            
            if (this.notKey.indexOf(this.input[this.pos]) >= 0) {
                if (optional && this.input[this.pos] !== ',') {
                    this.pos = start;
                    return "";
                }
                return this.input.substring(start, this.pos);
            } else {
                this.pos++;
            }
        }
    }

    private keyEqualsValue(): [string, string] {
        const key = this.key();
        if (this.tryMatch("=")) {
            this.match("=");
            const val = this.value();
            return [key.trim(), val];
        } else {
            throw new TypeError("Value expected, equals sign missing");
        }
    }

    private keyValueList(): void {
        const kv = this.keyEqualsValue();
        this.currentEntry.entryTags = {};
        this.currentEntry.entryTags[kv[0]] = kv[1];
        
        while (this.tryMatch(",")) {
            this.match(",");
            if (this.tryMatch("}")) {
                break;
            }
            const kvPair = this.keyEqualsValue();
            this.currentEntry.entryTags[kvPair[0]] = kvPair[1];
        }
    }

    private entryBody(d: string): void {
        this.currentEntry = { entryType: d.substring(1) };
        const citationKey = this.key(true);
        if (citationKey) {
            this.currentEntry.citationKey = citationKey;
            this.match(",");
        }
        this.keyValueList();
        this.entries.push(this.currentEntry);
    }

    private directive(): string {
        this.match("@");
        return "@" + this.key();
    }

    private preamble(): void {
        this.currentEntry = { entryType: 'PREAMBLE' };
        this.currentEntry.entry = this.valueComment();
        this.entries.push(this.currentEntry);
    }

    private comment(): void {
        this.currentEntry = { entryType: 'COMMENT' };
        this.currentEntry.entry = this.valueComment();
        this.entries.push(this.currentEntry);
    }

    private entry(d: string): void {
        this.entryBody(d);
    }

    private alternativeCitationKey(): void {
        this.entries.forEach(entry => {
            if (!entry.citationKey && entry.entryTags) {
                entry.citationKey = '';
                if (entry.entryTags.author) {
                    entry.citationKey += entry.entryTags.author.split(',')[0] + ', ';
                }
                entry.citationKey += entry.entryTags.year || '';
            }
        });
    }

    bibtex(): void {
        while (this.matchAt()) {
            const d = this.directive();
            this.match("{");
            
            if (d.toUpperCase() === "@STRING") {
                // Handle @STRING entries (not implemented in original)
            } else if (d.toUpperCase() === "@PREAMBLE") {
                this.preamble();
            } else if (d.toUpperCase() === "@COMMENT") {
                this.comment();
            } else {
                this.entry(d);
            }
            
            this.match("}");
        }
        
        this.alternativeCitationKey();
    }
}

export function toJSON(bibtex: string): BibtexEntry[] {
    const parser = new BibtexParser();
    parser.setInput(bibtex);
    parser.bibtex();
    return parser.getEntries();
}

export function toBibtex(entries: BibtexEntry[], compact: boolean = true): string {
    let out = '';
    
    // Define field order for better human readability
    const fieldOrder = [
        'title', 'author', 'journal', 'booktitle', 'year', 'volume', 'number', 
        'pages', 'month', 'publisher', 'address', 'edition', 'editor', 
        'institution', 'organization', 'school', 'note', 'doi', 'url', 'isbn', 'issn'
    ];
    
    for (const entry of entries) {
        out += `@${entry.entryType.toLowerCase()}{`;
        
        if (compact) {
            // Compact format (original behavior)
            if (entry.citationKey) {
                out += entry.citationKey + ',';
            }
            
            if (entry.entry) {
                out += entry.entry;
            }
            
            if (entry.entryTags) {
                let tags = '';
                for (const key in entry.entryTags) {
                    if (tags.length > 0) tags += ',';
                    tags += key + '={' + entry.entryTags[key] + '}';
                }
                out += tags;
            }
            
            out += '}\n';
        } else {
            // Human-readable format with proper indentation and field ordering
            if (entry.citationKey) {
                out += entry.citationKey + ',\n';
            }
            
            if (entry.entry) {
                out += '    ' + entry.entry + '\n';
            }
            
            if (entry.entryTags) {
                // Sort fields according to preferred order
                const sortedKeys = Object.keys(entry.entryTags).sort((a, b) => {
                    const aIndex = fieldOrder.indexOf(a.toLowerCase());
                    const bIndex = fieldOrder.indexOf(b.toLowerCase());
                    
                    if (aIndex !== -1 && bIndex !== -1) {
                        return aIndex - bIndex;
                    } else if (aIndex !== -1) {
                        return -1;
                    } else if (bIndex !== -1) {
                        return 1;
                    } else {
                        return a.localeCompare(b);
                    }
                });
                
                for (let i = 0; i < sortedKeys.length; i++) {
                    const key = sortedKeys[i];
                    const value = entry.entryTags[key];
                    
                    // Add proper indentation and alignment
                    const paddedKey = key.padEnd(12); // Align values for readability
                    out += `    ${paddedKey} = {${value}}`;
                    
                    // Add comma except for the last field
                    if (i < sortedKeys.length - 1) {
                        out += ',';
                    }
                    
                    out += '\n';
                }
            }
            
            out += '}\n\n';
        }
    }
    
    return out;
}

export { BibtexEntry };