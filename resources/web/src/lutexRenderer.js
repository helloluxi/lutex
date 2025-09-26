class LutexCore {
    constructor() {
        this.texPath = '';
        this.isAppx = false;
        this.numSecBeforeAppx = 999;

        // Parse state
        this.lineNum = 0;
        this.env = '';
        this.emptyLineCount = 0;
        this.envContent = [];
        this.paraHtml = [];
        this.secIdx = 0;
        this.subsecIdx = 0;

        // Labels
        this.autorefMap = new Map();
        this.equationLabels = [];
        this.tableLabels = [];
        this.figureLabels = [];
        this.thmLabels = [];

        // Navigation data structures
        this.navigationData = {
            sections: [],
            subsections: [],
            equations: [],
            figures: [],
            tables: [],
            theorems: []
        };

        // Static
        this.romanNumerals = ['O', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    }

    async render(texPath) {
        this.texPath = texPath;
        this.lineNum = 0;
        this.env = '';
        this.envContent = [];
        this.paraHtml = [];

        const rawContent = await fetch(texPath).then(response => response.text());
        let emptyLineCount = 0, hiddenEnv = '';
        for (let line of rawContent.split('\n')) {
            this.lineNum++;
            line = line.trim();
            if (line.length === 0) {
                emptyLineCount++;
            }
            line = line
                .replace(/^%%check$/, '<div class="checkpoint"></div>')
                .replace(/%(.*)$/, '');
            if (line.length !== 0) {
                // If we had multiple empty lines, start a new paragraph
                if (emptyLineCount !== 0) {
                    this.paraHtml.push(`<br>`);
                    if (this.envContent.length > 0) {
                        this.paraHtml.push(`<div class="todo">${this.envContent.join(' ')}</div>`);
                    }
                    this.envContent.length = 0;
                    emptyLineCount = 0;
                }
                // Process Line
                if (line.startsWith('\\section')) {
                    line.replace(
                        /\\section\{([^}]+)\}(\\label\{([^}]+)\})?/g, (match, content, labelPart, labelMatch) => {
                            ++this.secIdx;
                            this.subsecIdx = 0;
                            const label = labelMatch || `sec:${this.secIdx}`;
                            this.autorefMap.set(label, { type: 'sec', text: this.getSecName(this.secIdx), number: this.secIdx });
                            
                            // Store navigation data
                            this.navigationData.sections.push({
                                number: this.secIdx,
                                title: content,
                                label: label,
                                id: `sec-${this.secIdx}`,
                                command: `s ${this.secIdx}`,
                                display: `§${this.secIdx}: ${content}`
                            });
                            
                            this.paraHtml.push(`<h2 id="sec-${this.secIdx}" data-label="${label}" ${this.meta()}>${this.getSecName(this.secIdx)}. ${content}</h2>`);
                            return '';
                        }
                    );
                } else if (line.startsWith('\\subsection')) {
                    line.replace(
                        /\\subsection\{([^}]+)\}(\\label\{([^}]+)\})?/g, (match, content, labelPart, labelMatch) => {
                            ++this.subsecIdx;
                            const label = labelMatch || `subsec:${this.secIdx}.${this.subsecIdx}`;
                            const subsecName = this.getSubsecName(this.subsecIdx);
                            this.autorefMap.set(label, { 
                                type: 'subsec', 
                                text: subsecName, 
                                number: this.subsecIdx,
                                secNumber: this.secIdx 
                            });
                            
                            // Store navigation data
                            this.navigationData.subsections.push({
                                sectionNumber: this.secIdx,
                                subsectionNumber: this.subsecIdx,
                                title: content,
                                label: label,
                                id: `subsec-${this.secIdx}-${this.subsecIdx}`,
                                command: `s ${this.secIdx}.${this.subsecIdx}`,
                                display: `§${this.secIdx}.${this.subsecIdx}: ${content}`
                            });
                            
                            this.paraHtml.push(`<h3 id="subsec-${this.secIdx}-${this.subsecIdx}" data-label="${label}" ${this.meta()}>${subsecName}. ${content}</h3>`);
                            return '';
                        }
                    );
                } else if (line.startsWith('\\appendix')) {
                    this.isAppx = true;
                    this.numSecBeforeAppx = this.secIdx;
                } else if (this.env.length === 0 && line.startsWith('\\begin{')) {
                    this.env = line.substring(7, line.indexOf('}'));
                    line = line.substring(line.indexOf('}') + 1).trim();
                    if (this.checkTheorem(this.env)) {
                        // Match \begin{<env>}([name]?)(\label{<label>}?)
                        line.replace(
                            /^(\[([^\]]+)\])?(\\label\{([^}]+)\})?/g, (match, namePart, nameMatch, labelPart, labelMatch) => {
                                let name = nameMatch || '??';
                                let thmIdx = this.thmLabels.length + 1;
                                let label = labelMatch || `thm:${thmIdx}`;
                                this.thmLabels.push(label);
                                this.autorefMap.set(label, { type: 'thm', text: `${this.firstCapitalized(this.env)} ${thmIdx}`, number: thmIdx });
                                
                                // Store navigation data
                                this.navigationData.theorems.push({
                                    number: thmIdx,
                                    type: this.firstCapitalized(this.env),
                                    name: name,
                                    label: label,
                                    id: `thm-${thmIdx}`,
                                    command: `h ${thmIdx}`,
                                    display: `${this.firstCapitalized(this.env)} ${thmIdx}: ${name}`
                                });
                                
                                this.paraHtml.push(`<div class="theorem" id="thm-${thmIdx}" data-label="${label}" ${this.meta()}><strong>${this.firstCapitalized(this.env)} ${thmIdx} (${name}) </strong>`);
                                return '';
                            }
                        );
                        hiddenEnv = this.env;
                        this.env = '';
                    } else if (line) {
                        this.envContent.push(line);
                    }
                } else if (this.env.length > 0) {
                    if (line.startsWith('\\end{' + this.env + '}')) {
                        this.envContent.push(line.substring(0, line.indexOf('\\end{' + this.env + '}')).trim());
                        this.paraHtml.push(
                            this.checkEquation(this.env) ?
                                this.renderEquation(this.env, this.envContent.join(' ')) :
                            this.env.startsWith('figure') ?
                                this.renderFig(this.envContent.join(' ')) :
                            this.env.startsWith('table') ?
                                this.renderTab(this.envContent.join(' ')) :
                            `<div class="todo">${this.envContent.join(' ')}</div>`
                        );
                        this.envContent.length = 0;
                        this.env = '';
                    } else {
                        this.envContent.push(line);
                    }
                } else if (hiddenEnv && line.startsWith('\\end{' + hiddenEnv + '}')) {
                        this.paraHtml.push(`</div>`);
                        hiddenEnv = '';
                } else {
                    this.paraHtml.push(`<span ${this.meta()}>${line} </span>`);
                }
            }
        }

        let result = this.paraHtml.join('').replace(
            /\\todo\{([^}]*)}/g, (match, content) => {
                return `<span class="todo">(TODO: ${content.trim()})</span>`;
            }).replace(
                /\\"o/g, () => '&ouml;'
            ).replace(
                /\\emph\{([^}]+)\}/g, (match, content) => `<em>${content}</em>`
            ).replace(
                /\\textbf\{([^}]+)\}/g, (match, content) => `<strong>${content}</strong>`
            ).replace(
                /\\#/g, () => '#'
            ).replace(
                /~/g, () => '&nbsp;'
            ).replace(
                /\\cite\{([^}]+)\}/g, (match, content) => {
                    return content.split(',').map(c => `<span class="citation">[${c.trim()}]</span>`).join('');
                }
            ).replace(
                /\\pf{([^}]+)}/g, (match, pfLabel) => {
                    return `<div class="proof-panel">
                                <div class="proof-toggle" data-label="${pfLabel}">
                                    <span>Proof of&nbsp;&nbsp;${pfLabel}</span>
                                </div>
                                <div class="proof-content">`;
                }
            ).replace(
                /\\qed/g, () => {
                    return `</div></div>`;
                }
            );

        // Process autoref replacements at the very end
        result = result.replace(
            /\\autoref\{([^}]+)\}/g, (match, labelKey) => {
                if (!labelKey || !this.autorefMap.has(labelKey)) {
                    return `<span class="todo">${match}</span>`;
                }
                const refInfo = this.autorefMap.get(labelKey);
                const refText = refInfo.text;
                const refType = refInfo.type;
                const refNumber = refInfo.number;
                // Generate ID based on type and number format
                let refId;
                if (refType === 'subsec' && refInfo.secNumber) {
                    refId = `subsec-${refInfo.secNumber}-${refNumber}`;
                } else {
                    refId = `${refType}-${refNumber}`;
                }
                return `<a href="#${refId}" class="autoref">${refText}</a>`;
            }
        );

        return result;
    }

    meta() {
        return `file="${this.texPath}" line="${this.lineNum}"`;
    }

    // Helper function to extract content with paired braces
    extractBracedContent(text, command) {
        const index = text.indexOf(command + '{');
        if (index === -1) return null;
        
        let braceCount = 0;
        let startIndex = index + command.length + 1;
        let endIndex = startIndex;
        
        for (let i = startIndex; i < text.length; i++) {
            if (text[i] === '{') {
                braceCount++;
            } else if (text[i] === '}') {
                if (braceCount === 0) {
                    endIndex = i;
                    break;
                }
                braceCount--;
            }
        }
        
        if (endIndex > startIndex) {
            return {
                content: text.substring(startIndex, endIndex),
                fullMatch: text.substring(index, endIndex + 1)
            };
        }
        
        return null;
    }

    firstCapitalized(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    checkEquation(env) {
        return ['equation', 'align', 'gather'].includes(env);
    }

    checkMultiLineEq(env) {
        return ['align', 'gather'].includes(env);
    }

    checkTheorem(env) {
        return ['theorem', 'lemma', 'definition', 'corollary', 'example', 'problem'].includes(env);
    }
    
    numberToRoman(num) {
        return this.romanNumerals[num] || num.toString();
    }

    // Get section reference format
    getSecRef(num) {
        return num > this.numSecBeforeAppx ?
            'Appx.&nbsp;' + String.fromCharCode(64 + num - this.numSecBeforeAppx) :
            'Sec.&nbsp;' + this.numberToRoman(num);
    }

    // Convert label key to HTML ID
    labelToId(label) {
        return label.replace(':', '-');
    }

    // Get subsection name format (A, B, C, etc.)
    getSubsecName(num) {
        return String.fromCharCode(64 + num); // A, B, C, D, ...
    }

    // Get section name format
    getSecName(num) {
        return num > this.numSecBeforeAppx ?
            'Appendix ' + String.fromCharCode(64 + num - this.numSecBeforeAppx) :
            this.numberToRoman(num);
    }

    // Parse figure environment
    renderFig(content) {
        const figureIdx = this.figureLabels.length + 1;
        
        // Parse label
        let label = `fig:${figureIdx}`;
        content = content.replace(/\\label\{([^}]+)\}/, (match, labelMatch) => {
            label = labelMatch;
            return '';
        });
        
        this.figureLabels.push(label);
        this.autorefMap.set(label, { type: 'fig', text: `Fig.&nbsp;${figureIdx}`, number: figureIdx });

        // Store navigation data
        this.navigationData.figures.push({
            number: figureIdx,
            label: label,
            id: `fig-${figureIdx}`,
            command: `f ${figureIdx}`,
            display: `Fig ${figureIdx}: ${label}`
        });

        // Parse caption with paired braces
        let caption = '';
        const captionMatch = this.extractBracedContent(content, '\\caption');
        if (captionMatch) {
            caption = captionMatch.content;
            content = content.replace(captionMatch.fullMatch, '');
        }

        // Check if this is a subfloat structure
        const subfloatMatches = content.match(/\\subfloat\[([^\]]*)\]\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g);
        
        let figureContent = '';
        
        if (subfloatMatches && subfloatMatches.length > 0) {
            // Handle subfloat structure
            figureContent = '<div class="subfloats-container">';
            
            subfloatMatches.forEach((subfloatMatch, index) => {
                const subfloatParts = subfloatMatch.match(/\\subfloat\[([^\]]*)\]\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/);
                if (subfloatParts) {
                    const subfloatCaption = subfloatParts[1] || '';
                    const subfloatContent = subfloatParts[2];
                    
                    // Parse graphics in subfloat content
                    const graphicsMatch = subfloatContent.match(/\\includegraphics(?:\[width=([0-9.]*)\\textwidth\])?\s*\{([^}]+)\}/);
                    const graphicsPath = graphicsMatch ? graphicsMatch[2].trim() : '';
                    
                    // Parse subfloat label
                    const subfloatLabelMatch = subfloatContent.match(/\\label\{([^}]+)\}/);
                    const subfloatLabel = subfloatLabelMatch ? subfloatLabelMatch[1] : '';
                    
                    figureContent += `
                        <div class="subfloat" ${subfloatLabel ? `id="${subfloatLabel.replace(':', '-')}" data-label="${subfloatLabel}"` : ''}>
                            <div class="figure-placeholder">${graphicsPath}</div>
                            ${subfloatCaption ? `<div class="subfloat-caption">(${String.fromCharCode(97 + index)}) ${subfloatCaption}</div>` : ''}
                        </div>`;
                }
            });
            
            figureContent += '</div>';
        } else {
            // Handle single figure structure
            const graphicsMatch = content.match(/\\includegraphics(?:\[width=([0-9.]*)\\textwidth\])?\s*\{([^}]+)\}/s);
            const graphicsPath = graphicsMatch ? graphicsMatch[2].trim() : '';
            
            figureContent = `<div class="figure-placeholder">${graphicsPath}</div>`;
        }

        // Remove parsed elements from content
        content = content.replace(/\\includegraphics(?:\[[^\]]*\])?\s*\{[^}]+\}/sg, '');
        content = content.replace(/\\centering/g, '');
        content = content.replace(/\\subfloat\[([^\]]*)\]\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '');

        return `<div class="figure" id="fig-${figureIdx}" data-label="${label}" ${this.meta()}>
                ${figureContent}
                ${caption ? `<div class="figure-caption">Figure ${figureIdx}: ${caption}</div>` : ''}
            </div>`;
    }

    // Parse table environment
    renderTab(content) {
        const tableIdx = this.tableLabels.length + 1;

        // Parse label
        let label = `tab:${tableIdx}`;
        content = content.replace(/\\label\{([^}]+)\}/, (match, labelMatch) => {
            label = labelMatch;
            return '';
        });
        
        this.tableLabels.push(label);
        this.autorefMap.set(label, { type: 'tab', text: `Tab.&nbsp;${tableIdx}`, number: tableIdx });

        // Store navigation data
        this.navigationData.tables.push({
            number: tableIdx,
            label: label,
            id: `tab-${tableIdx}`,
            command: `t ${tableIdx}`,
            display: `Table ${tableIdx}: ${label}`
        });

        // Parse caption with paired braces
        let caption = '';
        const captionMatch = this.extractBracedContent(content, '\\caption');
        if (captionMatch) {
            caption = captionMatch.content;
            content = content.replace(captionMatch.fullMatch, '');
        }

        // Parse tabular content
        const tabularMatch = content.match(/\\begin\{tabular\}\{([^}]+)\}(.*?)\\end\{tabular\}/s);
        if (!tabularMatch) return '';

        // const columns = tabularMatch[1];
        const tableContent = tabularMatch[2];

        // Parse table rows
        const rows = tableContent
            .split(/(?:\\\\)?\s*\\hline/)
            .filter(row => row.trim())
            .map(row => {
                const cells = row.split('&').map(cell => cell.trim());
                return `<tr><td>${cells.join('</td><td>')}</td></tr>`;
            })
            .join('\n');

        return `<div class="table" id="tab-${tableIdx}" data-label="${label}" ${this.meta()}>
                    <table class="centered-table">
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                    ${caption ? `<div class="table-caption">Table ${tableIdx}: ${caption}</div>` : ''}
                </div>`;
    }

    // Parse equation environment
    renderEquation(env, content) {
        const eqIdx = this.equationLabels.length + 1;
        let label = `eq:${eqIdx}`;
        content = content.replace(/\\label\{([^}]+)\}/, (match, labelMatch) => {
            label = labelMatch;
            return '';
        });
        this.equationLabels.push(label);
        this.autorefMap.set(label, { type: 'eq', text: `Eq.&nbsp;(${eqIdx})`, number: eqIdx });
        
        // Store navigation data
        this.navigationData.equations.push({
            number: eqIdx,
            label: label,
            id: `eq-${eqIdx}`,
            command: `e ${eqIdx}`,
            display: `Eq (${eqIdx}): ${label}`
        });
        if (this.checkMultiLineEq(env)) { // Very coarse detection
            content.replace('\\\\', () => { this.equationLabels.push(`eq-${eqIdx}`); return '\\\\'; });
        }
        return `<div class="equation" id="eq-${eqIdx}" data-label="${label}" ${this.meta()}>\\begin{${env}}${content}\\end{${env}}</div>`;
    }
}

export default class LutexArticle {
    constructor() {
        // Metadata
        this.localHostPort = 0;
        this.githubRepo = '';
        this.arxivNum = '';

        // Parsing state
        this.titleHtml = '';
        this.authorHtml = '';
        this.affiliationHtml = '';
        this.abstractHtml = '';
        this.bibFiles = [];
        this.bodyFile = '';
        
        // Core instance for navigation data
        this.core = null;
    }

    getNavigationData() {
        return this.core ? this.core.navigationData : {
            sections: [],
            subsections: [],
            equations: [],
            figures: [],
            tables: [],
            theorems: []
        };
    }

    async render(texPath) {
        texPath = this.tryAddExtension(texPath, '.tex');
        let mainContent = '';
        await fetch(texPath).then(res => res.text()).then(text => {
            mainContent = text;
        });

        // Get listener port from global variable set by server
        if (window.lutexListenerPort) {
            this.localHostPort = window.lutexListenerPort;
        } else {
            this.localHostPort = 0; // No listener available
        }

        // Parse %%github:<this.githubRepo>
        const githubMatch = mainContent.match(/^%%github:(.+)$/m);
        if (githubMatch) {
            this.githubRepo = githubMatch[1].trim();
        }

        // Parse %%arxiv:<this.arxivNum>
        const arxivMatch = mainContent.match(/^%%arxiv:(.+)$/m);
        if (arxivMatch) {
            this.arxivNum = arxivMatch[1].trim();
        }

        // Parse \title{<this.titleHtml>}
        const titleMatch = mainContent.match(/\\title\{(.+?)\}/);
        if (titleMatch) {
            this.titleHtml = '<h1>' + titleMatch[1].trim() + '</h1>';
        }

        // Parse \author{<this.authorHtml>}
        const authorMatch = mainContent.match(/\\author\s*\{((?:[^{}]|\{[^{}]*\})*)\}/s);
        if (authorMatch) {
            this.authorHtml = '<div class="author">' + authorMatch[1].trim() + '</div>';
        }

        // Parse \affiliation{<this.affiliationHtml>}
        const affiliationMatch = mainContent.match(/\\affiliation\s*\{((?:[^{}]|\{[^{}]*\})*)\}/s);
        if (affiliationMatch) {
            this.affiliationHtml = '<div class="affiliation">' + affiliationMatch[1].trim().replace(/\\\\/g, '') + '</div>';
        }

        // Parse \input{<this.bodyFile>}
        const inputMatch = mainContent.match(/\\input\{(.+?)\}/);
        if (inputMatch) {
            this.bodyFile = inputMatch[1].trim();
        }

        // Parse \bibliography{<this.bibFiles>}
        const bibMatch = mainContent.match(/\\bibliography\{(.+?)\}/);
        if (bibMatch) {
            this.bibFiles = bibMatch[1].split(',').map(file => this.tryAddExtension(file.trim(), '.bib'));
        }

        // Parse multi-line new commands %region NewCmd <lines> %endregion
        const regionMatch = mainContent.match(/%region\s+NewCmd\s+([\s\S]*?)%endregion/);
        if (regionMatch) {
            const newCmdSection = regionMatch[1];
            // Parse individual newcommand/renewcommand definitions
            const cmdMatches = newCmdSection.match(/\\(?:re)?newcommand\s*\{([^}]+)\}(?:\[([0-9]+)\])?\s*\{((?:[^{}]|\{[^{}]*\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\}/g);
            if (cmdMatches && window.katexOptions) {
                cmdMatches.forEach(cmdMatch => {
                    const match = cmdMatch.match(/\\(?:re)?newcommand\s*\{([^}]+)\}(?:\[([0-9]+)\])?\s*\{((?:[^{}]|\{[^{}]*\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\}/);
                    if (match) {
                        const name = match[1], definition = match[3];
                        window.katexOptions.macros[name] = definition;
                    }
                });
            }
        }

        // Parse \begin{abstract} <abstract> \end{abstract}
        const abstractMatch = mainContent.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
        if (abstractMatch) {
            this.abstractHtml = abstractMatch[1].trim();
        }

        // Header content
        let html = this.titleHtml + this.authorHtml + this.affiliationHtml;
        if (this.githubRepo || this.arxivNum) {
            const linksHtml = `<div style="text-align: center; margin-top: 10px; font-size: 0.9em;">
                ${this.githubRepo ? `<a href="https://github.com/${this.githubRepo}" target="_blank">View on GitHub</a>` : ''}
                ${this.githubRepo && this.arxivNum ? ' | ' : ''}
                ${this.arxivNum ? `<a href="https://arxiv.org/pdf/${this.arxivNum}" target="_blank">View on arXiv</a>` : ''}
            </div>`;
            html += linksHtml;
        }
        html += `<div class="abstract">${this.abstractHtml}</div>`;

        // Body content
        this.core = new LutexCore();
        html += await this.core.render(this.bodyFile);

        // // References
        // if (this.bibliography.length > 0) {
        //     const refsHtml = this.bibliography.map(entry => {
        //         return `<li>${entry.title} (${entry.year})</li>`;
        //     }).join('');
        //     html += `<h2>References</h2><ul>${refsHtml}</ul>`;
        // }

        document.getElementById('content').innerHTML = html;
    }

    tryAddExtension(fileName, ext) {
        return fileName.includes('.') ? fileName : fileName + ext;
    }

    // // Load and parse bibliography
    // async loadBibliography(bibPath) {
    //     const bibtex = await fetch(bibPath).then(res => res.text());
    //     bibtexParse.toJSON(bibtex).forEach(entry => {
    //         const authors = entry.entryTags.author ? entry.entryTags.author.split(' and ').map(a => a.trim()) : [];
    //         const firstAuthor = authors[0] ? authors[0].split(',').map(n => n.trim())[0] : '';
    //         const year = entry.entryTags.year || '';
    //         const title = entry.entryTags.title || '';
    //         const journal = entry.entryTags.journal || entry.entryTags.booktitle || '';
    //         const url = entry.entryTags.url || '';

    //         this.citations.set(entry.citationKey, {
    //             authors: authors,
    //             title: title,
    //             journal: journal,
    //             year: year,
    //             firstAuthor: firstAuthor,
    //             url: url,
    //             number: 0
    //         });
    //     });
    // }

    // // Render complete document content
    // async renderBib(texPath) {
    //     if (this.bibFiles.length > 0) {
    //         await this.loadBibliography(this.bibFiles[0]);

    //         // Second pass: re-process citations now that bibliography is loaded
    //         html = this.processCitations(html);
    //     }

    //     // Generate references section
    //     const sortedCitations = Array.from(this.citations.entries())
    //         .filter(([key, citation]) => citation.number > 0)
    //         .sort((a, b) => a[1].number - b[1].number);
    //     const referencesHtml = sortedCitations
    //         .map(([key, citation]) => {
    //             const authors = citation.authors.map(author => {
    //                 const parts = author.split(',');
    //                 return parts.length > 1 ? `${parts[1].trim()} ${parts[0].trim()}` : author.trim() == 'others' ? 'et al.' : author.trim();
    //             }).join(', ');
    //             const url = citation.url ? `<a href="${citation.url}" target="_blank">${citation.url}</a>` : '';
    //             return `<div class="reference-item" id="ref-${key}">
    //                         [${citation.number}] ${authors}, "${citation.title}", ${citation.journal} (${citation.year}) ${url}
    //                     </div>`;
    //         })
    //         .join('\n');

    //     const referencesDiv = document.getElementById('references');
    //     if (sortedCitations.length > 0) {
    //         referencesDiv.style.borderTop = '1px solid var(--accent-dark)';
    //         referencesDiv.style.marginTop = '40px';
    //         referencesDiv.style.paddingTop = '20px';
    //         referencesDiv.innerHTML = `
    //                     <h2 id="references-title">References</h2>
    //                     ${referencesHtml}
    //                 `;
    //     } else {
    //         referencesDiv.style.borderTop = 'none';
    //         referencesDiv.style.marginTop = '0';
    //         referencesDiv.style.paddingTop = '0';
    //         referencesDiv.innerHTML = '';
    //     }
    // }
}