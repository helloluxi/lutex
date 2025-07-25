class LuTeXRenderer {
    constructor() {
        // Labels and references
        this.thmLabels = [];
        this.figureLabels = [];
        this.equationLabels = [];
        this.citationOrder = [];
        this.sectionLabels = [];
        this.subsectionLabels = [];
        this.tableLabels = [];
        this.citations = new Map();
        this.autorefMap = new Map();
        this.bibliography = null;

        // Metadata
        this.localHostPort = 0;
        this.githubRepo = '';
        this.arxivNum = '';

        // Parsing state
        this.readNewCmd = false;
        this.regionIgnore = false;
        this.isAppx = false;
        this.documentBegun = false;
        this.titleHtml = '';
        this.authorHtml = '';
        this.affiliationHtml = '';
        this.numSecBeforeAppx = 999;
        this.fileNameStack = [];
        this.lineNumStack = [];

        // Constants
        this.romanNumerals = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    }

    newFileName(fileName) {
        this.fileNameStack.push(fileName);
        this.lineNumStack.push(0);
    }

    popFileName() {
        this.fileNameStack.pop();
        this.lineNumStack.pop();
    }

    getFileNameAndLineNumStr() {
        const fileName = this.fileNameStack[this.fileNameStack.length - 1];
        const lineNum = this.lineNumStack[this.lineNumStack.length - 1];
        return `file="${fileName}" line="${lineNum}"`;
    }

    setLineNum(num) {
        this.lineNumStack[this.lineNumStack.length - 1] = num;
    }

    tryAddExtension(fileName, ext) {
        return fileName.includes('.') ? fileName : fileName + ext;
    }

    // Reusable method to fetch file content with error handling
    async fetchFileContent(fileName) {
        let fullFileName = fileName;

        try {
            const response = await fetch(fullFileName);
            if (response.ok) {
                return await response.text();
            } else {
                console.error(`Could not load file: ${fullFileName} (HTTP ${response.status})`);
                return null;
            }
        } catch (error) {
            console.error(`Error loading file ${fullFileName}:`, error);
            return null;
        }
    }

    // Convert number to Roman numeral
    numberToRoman(num) {
        return this.romanNumerals[num] || num.toString();
    }

    // Get section reference format
    getSecRef(num) {
        return num > this.numSecBeforeAppx ?
            'Appx.&nbsp;' + String.fromCharCode(64 + num - this.numSecBeforeAppx) :
            'Sec.&nbsp;' + this.numberToRoman(num);
    }

    // Get section name format
    getSecName(num) {
        return num > this.numSecBeforeAppx ?
            'Appendix ' + String.fromCharCode(64 + num - this.numSecBeforeAppx) :
            this.numberToRoman(num);
    }

    // Load and parse bibliography
    async loadBibliography(bibPath) {
        if (!bibPath) return;
        const bibtex = await this.fetchFileContent(bibPath);
        if (!bibtex) return;

        this.bibliography = bibtexParse.toJSON(bibtex);

        // Process bibliography entries
        this.bibliography.forEach(entry => {
            const authors = entry.entryTags.author ? entry.entryTags.author.split(' and ').map(a => a.trim()) : [];
            const firstAuthor = authors[0] ? authors[0].split(',').map(n => n.trim())[0] : '';
            const year = entry.entryTags.year || '';
            const title = entry.entryTags.title || '';
            const journal = entry.entryTags.journal || entry.entryTags.booktitle || '';

            this.citations.set(entry.citationKey, {
                authors: authors,
                title: title,
                journal: journal,
                year: year,
                firstAuthor: firstAuthor,
                number: 0
            });
        });
    }

    // Render complete document content
    async renderContent(texPath) {
        this.texPath = texPath;
        this.bibPath = null;

        // Initialize file stack with main file
        this.newFileName(texPath);

        const text = await this.fetchFileContent(texPath);
        if (!text) {
            console.error(`Failed to load main TeX file: ${texPath}`);
            return;
        }

        // First pass: parse LaTeX to find bibliography path
        let html = await this.parseLaTeX(text);

        // Clean up file stack
        this.popFileName();

        // Load bibliography if found during parsing
        if (this.bibPath) {
            await this.loadBibliography(this.bibPath);
            
            // Second pass: re-process citations now that bibliography is loaded
            html = this.processCitations(html);
        }

        document.getElementById('content').innerHTML = html;

        // Handle maketitle
        if (this.titleHtml || this.authorHtml || this.affiliationHtml) {
            document.getElementById('make-title').innerHTML = this.titleHtml + this.authorHtml + this.affiliationHtml;
            const linksHtml = `View on<a href="https://github.com/${this.githubRepo}" target="_blank">Github</a>or<a href="https://arxiv.org/pdf/${this.arxivNum}" target="_blank">arXiv</a>`;
            document.getElementById('tocLinks').innerHTML = linksHtml;
        }

        // Generate references section
        const sortedCitations = Array.from(this.citations.entries())
            .filter(([key, citation]) => citation.number > 0)
            .sort((a, b) => a[1].number - b[1].number);
        const referencesHtml = sortedCitations
            .map(([key, citation]) => {
                const authors = citation.authors.map(author => {
                    const parts = author.split(',');
                    return parts.length > 1 ? `${parts[1].trim()} ${parts[0].trim()}` : author.trim() == 'others' ? 'et al.' : author.trim();
                }).join(', ');
                return `<div class="reference-item" id="ref-${key}">
                            [${citation.number}] ${authors}, "${citation.title}", ${citation.journal} (${citation.year})
                        </div>`;
            })
            .join('\n');

        const referencesDiv = document.getElementById('references');
        if (sortedCitations.length > 0) {
            referencesDiv.style.borderTop = '1px solid var(--accent-dark)';
            referencesDiv.style.marginTop = '40px';
            referencesDiv.style.paddingTop = '20px';
            referencesDiv.innerHTML = `
                        <h2 id="references-title">References</h2>
                        ${referencesHtml}
                    `;
        } else {
            referencesDiv.style.borderTop = 'none';
            referencesDiv.style.marginTop = '0';
            referencesDiv.style.paddingTop = '0';
            referencesDiv.innerHTML = '';
        }
    }

    // Main parsing function
    async parseLaTeX(text) {
        let html = '';
        let lineNum = 0, para = '', segEnv = '', labelEnv = '', labelIdx = 0;

        for (let line of text.split('\n')) {
            lineNum++;

            line = line.trim();

            // Handle \input{filename} commands
            if (line.startsWith('\\input{') || line.includes('\\input{')) {
                const inputMatch = line.match(/\\input\{([^}]+)\}/);
                if (inputMatch) {
                    let inputFile = inputMatch[1].trim();
                    inputFile = this.tryAddExtension(inputFile, '.tex');
                    const inputText = await this.fetchFileContent(inputFile);
                    if (inputText) {
                        // Process paragraph before including file
                        if (para.trim() !== '') {
                            html += this.parsePara(para);
                            para = '';
                        }

                        // Parse included file recursively
                        this.newFileName(inputFile);
                        html += await this.parseLaTeX(inputText);
                        this.popFileName();

                        // Reset line number to current line after file inclusion
                    }

                    // Remove the \input command from the line
                    line = line.replace(/\\input\{[^}]+\}/, '').trim();
                    // If line is now empty, continue to next iteration
                    if (line === '') {
                        continue;
                    }
                }
            }

            if (line === '%region Ignore') {
                this.regionIgnore = true;
            } else if (line === '%endregion') {
                this.regionIgnore = false;
            } else if (this.regionIgnore) {
                continue;
            } else if (line.startsWith('%%')) {
                if (line.startsWith('%%github:')) {
                    this.githubRepo = line.substring(9).trim();
                } else if (line.startsWith('%%arxiv:')) {
                    this.arxivNum = line.substring(8).trim();
                } else if (line.startsWith('%%newcmd:')) {
                    this.readNewCmd = line.substring(9).trim() !== 'off';
                } else if (line.startsWith('%%port:')) {
                    this.localHostPort = parseInt(line.substring(7).trim() || '0');
                } else if (line.startsWith('%%check')) {
                    html += '<div class="checkpoint"></div>';
                }
            } else if (line.startsWith('\\newcommand') || line.startsWith('\\renewcommand')) {
                line.replace(/\\(?:re)?newcommand\{([^}]+)\}(?:\[([0-9]+)\])?\{((?:[^{}]|\{[^{}]*\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*)\}/g, (match, name, numArgs, definition) => {
                    if (this.readNewCmd && window.katexOptions) {
                        window.katexOptions.macros[name] = definition;
                    }
                    return '';
                });
            } else if (line.startsWith('\\begin{document}')) {
                this.documentBegun = true;
                para = '';
                this.setLineNum(lineNum + 1);
            } else if (line.startsWith('\\end{document}')) {
                this.documentBegun = false;
                para = '';
            } else if (line.startsWith('\\maketitle')) {
                // This will be handled by the UI code
                continue;
            } else if (line.startsWith('\\appendix')) {
                this.isAppx = true;
                this.numSecBeforeAppx = this.sectionLabels.length;
            } else if (line.startsWith('\\bibliography')) {
                // Parse bibliography path from \bibliography{filename}
                const bibMatch = line.match(/\\bibliography\{([^}]+)\}/);
                if (bibMatch) {
                    let bibFile = bibMatch[1].trim();
                    this.bibPath = this.tryAddExtension(bibFile, '.bib');
                }
                continue;
            } else if (this.documentBegun) { // Main text
                let isEmpty = line.trim() === '';
                let cmtIdx = line.indexOf('%');
                if (cmtIdx !== -1 && !(cmtIdx > 0 && line[cmtIdx - 1] === '\\')) {
                    line = line.substring(0, cmtIdx);
                }

                if (line.startsWith('\\section')) {
                    if (line.startsWith('\\section*')) {
                        const title = this.parsePairedBrace(line, 'section*');
                        html += `<h2 ${this.getFileNameAndLineNumStr()}>${title}</h2>`;
                    } else {
                        const sectionIdx = this.sectionLabels.length + 1;
                        this.sectionLabels.push(`sec-${sectionIdx}`);
                        this.subsectionLabels.push([]);
                        labelEnv = 'sec';
                        labelIdx = sectionIdx;
                        const title = this.parsePairedBrace(line, 'section');
                        html += `<h2 id="sec-${sectionIdx}" ${this.getFileNameAndLineNumStr()}>${this.getSecName(sectionIdx)}. ${title}</h2>`;
                    }
                    this.setLineNum(lineNum + 1);
                    line = line.substring(line.indexOf('}') + 1).trim();
                } else if (line.startsWith('\\subsection')) {
                    const sectionIdx = this.sectionLabels.length, subsecIdx = this.subsectionLabels[sectionIdx - 1].length + 1;
                    this.subsectionLabels[sectionIdx - 1].push(`sec-${sectionIdx}-${subsecIdx}`);
                    labelEnv = 'subsec';
                    labelIdx = subsecIdx;
                    const subsectionLetter = String.fromCharCode(64 + subsecIdx);
                    const title = this.parsePairedBrace(line, 'subsection');
                    html += `<h3 class="subsection" id="sec-${sectionIdx}-${subsectionLetter}" ${this.getFileNameAndLineNumStr()}>${subsectionLetter}. ${title}</h3>`;
                    this.setLineNum(lineNum + 1);
                    line = line.substring(line.indexOf('}') + 1).trim();
                } else if (line.startsWith('\\pf{')) {
                    html += this.parsePara(para);
                    this.setLineNum(lineNum + 1);
                    para = '';
                    const pfLabel = line.substring(4, line.indexOf('}')).trim();
                    line = line.substring(line.indexOf('}') + 1).trim();
                    if (!this.autorefMap.has(pfLabel)) {
                        html += `<div class="proof-panel">
                                <div class="proof-toggle">
                                    <span>Proof of&nbsp;&nbsp;${pfLabel}</span>
                                </div>
                                <div class="proof-content">`;
                    } else {
                        const [href, displayName] = this.autorefMap.get(pfLabel);
                        const isExpandedKey = `latex.${pfLabel}`;
                        html += `<div class="proof-panel collapsed">
                                    <div class="proof-toggle" onclick="toggleProof(this.parentElement, '${isExpandedKey}')">
                                        <span>Proof of&nbsp;&nbsp;</span><a href="${href}" onclick="event.stopPropagation()">${displayName}</a>
                                    </div>
                                    <div class="proof-content">`;
                    }
                } else if (line == '\\qed') {
                    html += this.parsePara(para);
                    this.setLineNum(lineNum + 1);
                    para = '';
                    line = '';
                    html += `<span class="qed">&#x220E;</span></div></div>`;
                } else if (line.startsWith('\\begin{')) {
                    const newEnv = line.substring(7, line.indexOf('}')).trim();
                    if (newEnv === 'theorem' || newEnv === 'lemma' || newEnv === 'definition' || newEnv === 'corollary' || newEnv === 'example') {
                        labelEnv = newEnv;
                        labelIdx = this.thmLabels.length + 1;
                        this.thmLabels.push(`${newEnv.substring(0, 3)}-${labelIdx}`);
                        let displayName = `${newEnv[0].toUpperCase()}${newEnv.slice(1)} ${labelIdx} `;
                        line.replace(/\[(.*?)\]/g, (match, label) => {
                            displayName += `(${label}) `;
                            return '';
                        });
                        html += `<div class="theorem" id="${newEnv.substring(0, 3)}-${labelIdx}"><strong>${displayName}</strong>`;
                    } else {
                        if (segEnv === '') {
                            html += this.parsePara(para);
                            para = '';
                            segEnv = newEnv;
                            this.setLineNum(lineNum + 1);
                        }

                        if (newEnv === 'equation' || newEnv === 'align' || newEnv === 'gather' || newEnv === 'eqnarray') {
                            labelEnv = 'eq';
                            labelIdx = this.equationLabels.length + 1;
                            this.equationLabels.push(`eq-${labelIdx}`);
                            para += line + '\n';
                        } else if (newEnv.startsWith('figure')) {
                            labelEnv = 'fig';
                            labelIdx = this.figureLabels.length + 1;
                            this.figureLabels.push(`fig-${labelIdx}`);
                        } else if (newEnv.startsWith('table')) {
                            labelEnv = 'tab';
                            labelIdx = this.tableLabels.length + 1;
                            this.tableLabels.push(`tab-${labelIdx}`);
                        } else if (newEnv === 'itemize') {
                            html += `<ul class="itemize" ${this.getFileNameAndLineNumStr()}>`;
                        } else if (newEnv != 'abstract') {
                            para += `\\begin{${newEnv}}`;
                        }
                    }
                    line = line.substring(line.indexOf('}') + 1).trim();
                }

                line = line.replace(/\\label\{([^}]+)\}/g, (match, label) => {
                    if (labelEnv === 'sec') {
                        this.sectionLabels[labelIdx - 1] = label;
                        this.autorefMap.set(label, [`#${label}`, this.getSecRef(labelIdx)]);
                    } else if (labelEnv === 'subsec') {
                        const secIdx = this.sectionLabels.length;
                        this.subsectionLabels[this.sectionLabels.length - 1][labelIdx - 1] = label;
                        this.autorefMap.set(label, [`#${label}`, this.getSecRef(secIdx) + '.' + String.fromCharCode(64 + labelIdx)]);
                    } else if (labelEnv === 'theorem' || labelEnv === 'lemma' || labelEnv === 'definition' || labelEnv === 'corollary' || labelEnv === 'example') {
                        this.thmLabels[labelIdx - 1] = label;
                        this.autorefMap.set(label, [`#${labelEnv.substring(0, 3)}-${labelIdx}`, `${labelEnv[0].toUpperCase()}${labelEnv.slice(1)}&nbsp;${labelIdx}`]);
                    } else if (labelEnv === 'eq') {
                        this.equationLabels[labelIdx - 1] = label;
                        this.autorefMap.set(label, [`#eq-${labelIdx}`, `Eq.&nbsp;(${labelIdx})`]);
                    } else if (labelEnv === 'fig') {
                        this.figureLabels[labelIdx - 1] = label;
                        this.autorefMap.set(label, [`#fig-${labelIdx}`, `Fig.&nbsp;${labelIdx}`]);
                    } else if (labelEnv === 'tab') {
                        this.tableLabels[labelIdx - 1] = label;
                        this.autorefMap.set(label, [`#tab-${labelIdx}`, `Tab.&nbsp;${labelIdx}`]);
                    }
                    return '';
                });

                if (line.startsWith('\\end{')) {
                    const endEnv = line.substring(5, line.indexOf('}')).trim();
                    if (endEnv === 'theorem' || endEnv === 'lemma' || endEnv === 'definition' || endEnv === 'corollary' || endEnv === 'example') {
                        html += this.parsePara(para);
                        para = '';
                        segEnv = '';
                        this.setLineNum(lineNum + 1);
                        html += '</div>';
                        continue;
                    }

                    if (segEnv !== '' && endEnv === segEnv) {
                        if (segEnv.startsWith('figure')) {
                            html += this.parseFigure(para);
                        } else if (segEnv.startsWith('table')) {
                            html += this.parseTable(para);
                        } else if (segEnv === 'theorem' || segEnv === 'lemma' || segEnv === 'definition') {
                            html += '</div>';
                        } else if (segEnv === 'equation' || segEnv === 'align' || segEnv === 'gather' || segEnv === 'eqnarray') {
                            para += line;
                            html += this.parseEquation(para, segEnv !== 'equation');
                        } else if (segEnv == 'itemize') {
                            html += para.split('\\item').slice(1).map(item => `<li>${item.trim()}</li>`).join('') + '</ul>';
                        } else if (segEnv === 'abstract') {
                            html += `<div class="abstract">${para}</div>`;
                        } else {
                            html += this.parsePara(para);
                        }
                        para = '';
                        segEnv = '';
                        this.setLineNum(lineNum + 1);
                    } else {
                        para += line + '\n';
                    }
                } else if (isEmpty) {
                    html += this.parsePara(para);
                    para = '';
                    segEnv = '';
                    this.setLineNum(lineNum + 1);
                } else {
                    para += line.trim() + '\n';
                }
            }
        }

        // Process any remaining paragraph
        html += this.parsePara(para);

        return html.replace(/\\autoref\{([^}]+)\}/g, (match, label) => {
            if (!this.autorefMap.has(label)) {
                return `<span class="autoref-placeholder" data-id="${label}"></span>`;
            }
            const [href, displayName] = this.autorefMap.get(label);
            return `<a href="${href}" onclick="event.stopPropagation()">${displayName}</a>`;
        }).replace(
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
            );
    }

    // Process citations after bibliography is loaded
    processCitations(html) {
        return html.replace(/\\cite\{([^}]+)\}/g, (match, refKeys) => {
            const keys = refKeys.split(',').map(k => k.trim());
            return keys.map(key => {
                const citation = this.citations.get(key);
                if (citation) {
                    if (!this.citationOrder.includes(key)) {
                        this.citationOrder.push(key);
                        citation.number = this.citationOrder.indexOf(key) + 1;
                    }

                    const tooltip = `[${citation.number}] ${citation.authors.join(', ')}, "${citation.title}", ${citation.journal} (${citation.year})`;
                    const escapedTooltip = tooltip.replace(/"/g, '&quot;');
                    return `<a class="citation" data-tooltip="${escapedTooltip}" data-key="${key}" href="https://scholar.google.com/scholar?q=${encodeURIComponent(citation.title)}" target="_blank">[${citation.number}]</a>`;
                } else {
                    return `<span style="color: orange;">[${key}]</span>`;
                }
            }).join('');
        });
    }

    // Parse paired braces helper function
    parsePairedBrace(content, cmd) {
        let length = 0;
        let start = content.indexOf(`\\${cmd}{`);
        if (start !== -1) {
            start += cmd.length + 2;
            let braceCount = 1;
            let i = start;
            while (i < content.length && braceCount > 0) {
                if (content[i] === '{') braceCount++;
                if (content[i] === '}') braceCount--;
                if (braceCount > 0) length++;
                i++;
            }
        }
        return content.substring(start, start + length);
    }

    // Parse paragraph content
    parsePara(para) {
        para = para.replace(
            /\\title\{([^}]+)\}/g, (match, title) => { this.titleHtml = `<h1>${title}</h1>`; return ''; }
        ).replace(
            /\\author\{(?:(?:\{[^{}]*\})|[^{}])*\}/g, (match) => {
                const content = match.slice(8, -1);
                this.authorHtml = `<div class="author">${content}</div>`;
                return '';
            }
        ).replace(
            /\\affiliation\{([^}]+)\}/g, (match, affiliation) => { this.affiliationHtml = `<div class="affiliation">${affiliation.replace(/\\\\/g, '')}</div>`; return ''; }
        ).replace(
            '\n', ' '
        );
        return para.trim() !== '' ? `<p ${this.getFileNameAndLineNumStr()}>${para}</p>` : '';
    }

    // Parse figure environment
    parseFigure(content) {
        const figureIdx = this.figureLabels.length + 1;
        const figureId = `fig-${figureIdx}`;

        // Parse caption
        const caption = this.parsePairedBrace(content, 'caption');

        // Parse graphics with width parameter
        const graphicsMatch = content.match(/\\includegraphics(?:\[width=([0-9.]*)\\textwidth\])?\s*\{([^}]+)\}/s);
        const graphicsPath = graphicsMatch ? graphicsMatch[2].trim() : '';
        const widthFactor = graphicsMatch && graphicsMatch[1] ? parseFloat(graphicsMatch[1]) : 1;

        // Remove parsed elements from content
        content = content.replace(/\\label\{fig:[^}]+\}/, '');
        content = content.replace(`\\caption{${caption}}`, '');
        content = content.replace(/\\includegraphics(?:\[[^\]]*\])?\s*\{[^}]+\}/s, '');
        content = content.replace(/\\centering/, '');

        let figureContent = '';
        if (graphicsPath) {
            // if (!editMode || !isLocalHost) {
            // Show actual figure
            const fileExtension = graphicsPath.split('.').pop().toLowerCase();
            const heightPx = widthFactor * 0.75 * screen.width; // Assume 4:3 aspect ratio
            if (fileExtension === 'pdf') {
                figureContent = `<div style="text-align: center;">
                            <iframe src="fig/${graphicsPath}#toolbar=0&navpanes=0&scrollbar=0&view=FitH"
                                style="width: ${widthFactor * 100}%; height: ${heightPx}px; border: none;"
                                title="Figure ${figureIdx}">
                                <p>Your browser does not support PDFs. 
                                <a href="fig/${graphicsPath}" target="_blank">Click here to download the PDF</a>.</p>
                            </iframe>
                        </div>`;
            } else {
                figureContent = `<div style="text-align: center;">
                            <img src="fig/${graphicsPath}" alt="Figure ${figureIdx}" style="width: ${widthFactor * 100}%;">
                        </div>`;
            }
        }

        return `<div class="figure" id="${figureId}" ${this.getFileNameAndLineNumStr()}>
                ${figureContent}
                ${caption ? `<div class="figure-caption">Figure ${figureIdx}: ${caption}</div>` : ''}
            </div>`;
    }

    // Parse table environment
    parseTable(content) {
        const tableIdx = this.tableLabels.length + 1;
        const tableId = `tab-${tableIdx}`;

        // Parse caption
        const caption = this.parsePairedBrace(content, 'caption');

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

        return `<div class="table" id="${tableId}" ${this.getFileNameAndLineNumStr()}>
                    <table class="centered-table">
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                    ${caption ? `<div class="table-caption">Table ${tableIdx}: ${caption}</div>` : ''}
                </div>`;
    }

    // Parse equation environment
    parseEquation(content, multiline) {
        const eqIdx = this.equationLabels.length;
        content = content.replace(/\\label\{([^}]+)\}/, (match, label) => {
            this.equationLabels[eqIdx - 1] = label;
            this.autorefMap.set(label, [`#eq-${eqIdx}`, `Eq. (${eqIdx})`]);
            return '';
        });
        if (multiline) {
            content.replace('\\\\', () => { this.equationLabels.push(`eq-${eqIdx}`); return '\\\\'; });
        }
        return `<div id="eq-${eqIdx}" ${this.getFileNameAndLineNumStr()}>${content}</div>`;
    }
}

// Export for ES6 modules
export default LuTeXRenderer;

// CommonJS compatibility
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = LuTeXRenderer;
}