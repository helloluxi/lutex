export class SlidesRenderer {
    private slides: any[];
    private citeTexts: string[];
    private currentSlide: any;
    private currentContent: string;
    private citeIdx: number;
    private startLineNumber: number;
    private graphicsPath: string;

    constructor() {
        this.slides = [];
        this.citeTexts = [];
        this.currentSlide = null;
        this.currentContent = '';
        this.citeIdx = 0;
        this.startLineNumber = 1;
        this.graphicsPath = '.';
    }

    parseMarkdown(text: string) {
        // Reset state
        this.slides = [];
        this.citeTexts = [];
        this.currentSlide = null;
        this.currentContent = '';
        this.citeIdx = 0;
        this.startLineNumber = 1;

        // Split paragraphs while tracking line numbers
        const lines = text.split(/\r?\n/);
        const paras: Array<{ content: string; startLine: number }> = [];
        let currentPara: string[] = [];
        let paraStartLine = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') {
                if (currentPara.length > 0) {
                    paras.push({
                        content: currentPara.join('\n'),
                        startLine: paraStartLine
                    });
                    currentPara = [];
                }
                // Skip empty lines and update start line for next paragraph
                while (i + 1 < lines.length && lines[i + 1].trim() === '') {
                    i++;
                }
                paraStartLine = i + 2;
            } else {
                if (currentPara.length === 0) {
                    paraStartLine = i + 1;
                }
                currentPara.push(line);
            }
        }

        // Add final paragraph if exists
        if (currentPara.length > 0) {
            paras.push({
                content: currentPara.join('\n'),
                startLine: paraStartLine
            });
        }

        for (let para of paras) {
            this.startLineNumber = para.startLine;
            this.processParagraph(para.content);
        }
        this.closeCurrentSlide();
        return this.slides;
    }

    private postprocessText(text: string): string {
        return text
            // Handle \url[display text]{url} and \url{url}
            .replace(/\\url(?:\[([^\]]*)\])?\{([^}]*)\}/g, (match, displayText, url) => {
                const text = displayText || url;
                return `<a href="${url}" target="_blank">${text}</a>`;
            })
            // Handle \strong{...}
            .replace(/\\strong\{([^}]*)\}/g, (match, content) => {
                return `<strong>${content}</strong>`;
            })
            // Handle \emph{...}
            .replace(/\\emph\{([^}]*)\}/g, (match, content) => {
                return `<em>${content}</em>`;
            })
            // Handle \cite[url]{footnote text}
            .replace(/\\cite(?:\[(.*?)\])?\{([^}]*)\}/g, (match, url, footnoteText) => {
                this.citeIdx++;
                this.citeTexts.push(footnoteText);
                return `<span class="footnote-cite" data-idx="${this.citeIdx}" data-url="${url}">[${this.citeIdx}]</span>`;
            });
    }

    private processParagraph(para: string): void {
        let lastListLevel = -1;
        let cachedLines: string[] = [];
        let codeBlockOpen = false;
        let codeLanguage = '';
        let currentLineNumber = this.startLineNumber;

        const closeList = () => {
            if (lastListLevel >= 0) {
                for (let i = 0; i <= lastListLevel; i++) {
                    this.currentContent += `</ul>`;
                }
                lastListLevel = -1;
            }
        };

        const renderCachedLines = () => {
            const joinedLines = cachedLines.join(' ').trim();
            if (joinedLines.startsWith('<') && joinedLines.endsWith('>')) {
                this.currentContent += `<div line="${currentLineNumber}">${joinedLines}</div>`;
            } else if (joinedLines.length > 0) {
                const processedText = this.postprocessText(joinedLines);
                this.currentContent += `<p line="${currentLineNumber}">${processedText}</p>`;
            }
            cachedLines = [];
        };

        const lines = para.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let trimmedLine = line.trim();
            const lineNumber = currentLineNumber + i;

            // Handle headings (slide creation)
            if (line.startsWith('# ')) {
                renderCachedLines();
                closeList();
                this.closeCurrentSlide();
                this.createTitleSlide(line.substring(2).trim(), lineNumber);
                continue;
            } else if (line.startsWith('## ')) {
                renderCachedLines();
                closeList();
                this.closeCurrentSlide();
                this.createSlide(line.substring(3).trim(), lineNumber);
                continue;
            } else if (line.startsWith('### ')) {
                renderCachedLines();
                closeList();
                this.currentContent += `<h3 line="${lineNumber}">${line.substring(4).trim()}</h3>`;
                continue;
            } else if (line.startsWith('#### ')) {
                renderCachedLines();
                closeList();
                this.currentContent += `<h4 line="${lineNumber}">${line.substring(5).trim()}</h4>`;
                continue;
            }
            
            // Handle special commands
            else if (trimmedLine.startsWith('\\quote{')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\quote\{([^}]*)\}\{([^}]*)\}/);
                if (match) {
                    const [, text, author] = match;
                    this.currentContent += `<div class="quote-container" line="${lineNumber}"><p class="quote-text">${text}</p><p class="quote-author">- ${author}</p></div>`;
                }
                continue;
            } else if (trimmedLine.startsWith('\\centertitle{')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\centertitle\{([^}]*)\}/);
                if (match) {
                    const content = match[1];
                    this.currentContent += `<h1 style="font-size: 6rem; color: #3498db; text-align: center;" line="${lineNumber}">${content}</h1>`;
                }
                continue;
            } else if (trimmedLine.startsWith('\\subtitle{')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\subtitle\{([^}]*)\}/);
                if (match) {
                    let content = match[1].replace(/\\\\/g, '<br>');
                    this.currentContent += `<p class="subtitle" line="${lineNumber}">${content}</p>`;
                }
                continue;
            } else if (trimmedLine.startsWith('\\subsubtitle{')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\subsubtitle\{([^}]*)\}/);
                if (match) {
                    let content = match[1].replace(/\\\\/g, '<br>');
                    this.currentContent += `<p class="subsubtitle" line="${lineNumber}">${content}</p>`;
                }
                continue;
            } else if (trimmedLine.startsWith('\\today')) {
                renderCachedLines();
                closeList();
                this.currentContent += `<p id="current-date" style="font-size: 2rem;" line="${lineNumber}"></p>`;
                continue;
            } else if (trimmedLine.startsWith('\\figure')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\figure(?:\[([^\]]*)\])?\{([^}]*)\}\{([^}]*)\}/);
                if (match) {
                    const [, ratio, src, caption] = match;
                    const ratioAttr = ratio || '1.0';
                    const imgSrc = src.includes('://') ? src : `${this.graphicsPath}/${src}`;
                    this.currentContent += `<div class="figure" line="${lineNumber}"><img src="${imgSrc}" alt="${caption}" style="width: ${parseFloat(ratioAttr) * 100}%; height: auto;"><div class="figure-caption">${caption}</div></div>`;
                }
                continue;
            } else if (trimmedLine.startsWith('\\qrcode{')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\qrcode\{([^}]*)\}\{([^}]*)\}/);
                if (match) {
                    const [, message, caption] = match;
                    try {
                        const qrId = 'qr-' + Math.random().toString(36).substr(2, 9);
                        this.currentContent += `<div class="figure" line="${lineNumber}"><div class="qr-box"><div class="qr-container" id="${qrId}" data-message="${message}"></div><div class="figure-caption">${caption}</div></div></div>`;
                    } catch (error) {
                        console.error('Error generating QR code:', error);
                        this.currentContent += `<div class="figure" line="${lineNumber}"><div class="qr-box"><div class="qr-error">Error generating QR code</div><div class="figure-caption">${caption}</div></div></div>`;
                    }
                }
                continue;
            } else if (trimmedLine.startsWith('\\refhtml{')) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/\\refhtml\{([^}]*)\}/);
                if (match) {
                    const refId = match[1];
                    this.currentContent += `<div class="html-ref" data-ref-id="${refId}" line="${lineNumber}"></div>`;
                }
                continue;
            } else if (trimmedLine.match(/^\\columns\*?(?:\[([^\]]*)\])?/)) {
                renderCachedLines();
                closeList();
                const match = trimmedLine.match(/^\\columns(\*?)(?:\[([^\]]*)\])?/);
                if (match) {
                    const isHighlighted = match[1] === '*';
                    const weights = match[2];
                    const firstColumnClass = isHighlighted ? 'column highlight' : 'column';

                    if (weights) {
                        this.currentContent += `<div class="columns" data-weights="${weights}" line="${lineNumber}"><div class="${firstColumnClass}">`;
                    } else {
                        this.currentContent += `<div class="columns" line="${lineNumber}"><div class="${firstColumnClass}">`;
                    }
                }
                continue;
            } else if (trimmedLine.startsWith('\\column*')) {
                renderCachedLines();
                closeList();
                this.currentContent += `</div><div class="column highlight" line="${lineNumber}">`;
                continue;
            } else if (trimmedLine.startsWith('\\column')) {
                renderCachedLines();
                closeList();
                this.currentContent += `</div><div class="column" line="${lineNumber}">`;
                continue;
            } else if (trimmedLine.startsWith('\\beginrow')) {
                renderCachedLines();
                closeList();
                this.currentContent += `<div class="figure-row" line="${lineNumber}">`;
                continue;
            } else if (trimmedLine.startsWith('\\endrow')) {
                renderCachedLines();
                closeList();
                this.currentContent += `</div>`;
                continue;
            } else if (trimmedLine.startsWith('\\endcolumn')) {
                renderCachedLines();
                closeList();
                this.currentContent += `</div></div>`;
                continue;
            } else if (trimmedLine.startsWith('\\graphicspath')) {
                const match = trimmedLine.match(/\\graphicspath\{([^}]*)\}/);
                if (match) {
                    this.graphicsPath = match[1];
                }
                continue;
            }

            // Handle lists
            if (trimmedLine.startsWith('+ ') || trimmedLine.startsWith('- ')) {
                const matchResult = line.match(/^(\s*)[+-]\s+(.*)/);
                if (matchResult) {
                    const [, spaceMatch, listContent] = matchResult;
                    renderCachedLines();
                    const thisListLevel = spaceMatch.length >> 1;

                    if (thisListLevel < lastListLevel) {
                        for (let i = 0; i < lastListLevel - thisListLevel; i++) {
                            this.currentContent += `</ul>`;
                        }
                    }

                    if (thisListLevel > lastListLevel) {
                        for (let i = 0; i < thisListLevel - lastListLevel; i++) {
                            this.currentContent += `<ul class="itemize" line="${lineNumber}">`;
                        }
                    }

                    this.currentContent += `<li line="${lineNumber}">${this.postprocessText(listContent)}</li>`;
                    lastListLevel = thisListLevel;
                }
                continue;
            }

            closeList();

            // Handle code blocks
            if (line.startsWith('```')) {
                renderCachedLines();
                if (codeBlockOpen) {
                    this.currentContent += `</code><button class="copy-button">Copy</button></pre>`;
                    codeBlockOpen = false;
                    codeLanguage = '';
                } else {
                    codeLanguage = trimmedLine.substring(3).trim();
                    this.currentContent += `<pre line="${lineNumber}">`;
                    if (codeLanguage) {
                        this.currentContent += `<div class="markdown-code-lang">${codeLanguage}</div>`;
                    }
                    this.currentContent += '<code>';
                    codeBlockOpen = true;
                }
                continue;
            }

            // Handle code block content
            if (codeBlockOpen) {
                this.currentContent += this.escapeHtml(line) + '\n';
                continue;
            }

            // Cache regular lines
            if (trimmedLine.length > 0) {
                if (cachedLines.length === 0) {
                    currentLineNumber = lineNumber;
                }
                cachedLines.push(line);
            }
        }

        closeList();
        renderCachedLines();
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private createTitleSlide(title: string, lineNumber: number): void {
        if (typeof document !== 'undefined') {
            document.title = title.trim();
        }

        this.currentSlide = {
            type: 'title',
            className: 'slide title-slide',
            title: title,
            content: '',
            lineNumber: lineNumber
        };
        this.currentContent = '';
    }

    private createSlide(title: string = '', lineNumber: number): void {
        this.currentSlide = {
            type: 'regular',
            className: 'slide',
            title: title,
            content: '',
            lineNumber: lineNumber
        };
        this.currentContent = '';
    }

    private closeCurrentSlide(): void {
        if (this.currentSlide) {
            this.currentSlide.content = this.currentContent;
            this.slides.push(this.currentSlide);
            this.currentSlide = null;
            this.currentContent = '';
        }
    }

    renderToContainer(container: HTMLElement): NodeListOf<Element> {
        container.innerHTML = '';

        this.slides.forEach(slide => {
            const slideElement = document.createElement('div');
            slideElement.className = slide.className;
            if (slide.lineNumber) {
                slideElement.setAttribute('line', slide.lineNumber.toString());
            }

            if (slide.type === 'title') {
                slideElement.innerHTML = `
                    <div class="slide-content">
                        <h1 line="${slide.lineNumber || ''}">${slide.title}</h1>
                        ${slide.content}
                    </div>
                `;
            } else {
                const headerHtml = slide.title ? `<div class="slide-header"><h2 line="${slide.lineNumber || ''}">${slide.title}</h2></div>` : '';
                slideElement.innerHTML = `
                    ${headerHtml}
                    <div class="slide-content">
                        ${slide.content}
                    </div>
                `;
            }

            container.appendChild(slideElement);
        });

        // Process special elements after rendering
        this.processAllSlideSpecialElements(container);

        return container.querySelectorAll('.slide');
    }

    private initializeQRCodes(container: HTMLElement): void {
        if (typeof (window as any).QRCode === 'undefined') {
            console.warn('QRCode library not loaded');
            return;
        }

        container.querySelectorAll('.qr-container').forEach(qrContainer => {
            const message = qrContainer.getAttribute('data-message');
            if (message && !qrContainer.querySelector('canvas, img')) {
                try {
                    new (window as any).QRCode(qrContainer, {
                        text: message.trim(),
                        width: 300,
                        height: 300,
                        colorDark: '#000000',
                        colorLight: '#ffffff',
                        correctLevel: (window as any).QRCode.CorrectLevel.H
                    });
                } catch (error) {
                    console.error('Error generating QR code:', error);
                    qrContainer.innerHTML = '<div class="qr-error">Error generating QR code</div>';
                }
            }
        });
    }

    private processAllSlideSpecialElements(container: HTMLElement): void {
        // Process equations
        container.querySelectorAll('.equation').forEach(equation => {
            const content = equation.textContent?.trim() || '';
            if (!content.startsWith('$') && !content.endsWith('$')) {
                equation.textContent = `$${content}$`;
            }
        });

        // Process footnotes for each slide
        container.querySelectorAll('.slide').forEach(slide => {
            this.processSlideFootnotes(slide as HTMLElement);
        });

        // Setup copy buttons
        this.setupCopyButtons(container);

        // Initialize QR codes
        this.initializeQRCodes(container);

        // Setup columns
        this.setupColumns(container);
    }

    private processSlideFootnotes(slide: HTMLElement): void {
        const footnoteCites = slide.querySelectorAll('.footnote-cite');
        if (footnoteCites.length > 0) {
            let footnoteContainer = slide.querySelector('.footnote') as HTMLElement;
            if (!footnoteContainer) {
                footnoteContainer = document.createElement('div');
                footnoteContainer.className = 'footnote';
                const footnoteParagraph = document.createElement('p');
                footnoteContainer.appendChild(footnoteParagraph);
                slide.querySelector('.slide-content')?.appendChild(footnoteContainer);
            }

            const footnoteParagraph = footnoteContainer.querySelector('p');
            if (footnoteParagraph) {
                footnoteCites.forEach((cite, index) => {
                    const citeIdx = parseInt(cite.getAttribute('data-idx') || '0');
                    const footnoteText = this.citeTexts[citeIdx - 1];
                    const url = cite.getAttribute('data-url');

                    if (index > 0) {
                        footnoteParagraph.appendChild(document.createTextNode(' '));
                    }

                    if (url && url !== 'undefined') {
                        const link = document.createElement('a');
                        link.href = url;
                        link.target = '_blank';
                        link.textContent = `[${citeIdx}]`;
                        footnoteParagraph.appendChild(link);
                        footnoteParagraph.appendChild(document.createTextNode(` ${footnoteText}`));
                    } else {
                        footnoteParagraph.appendChild(document.createTextNode(`[${citeIdx}] ${footnoteText}`));
                    }
                });
            }
        }
    }

    private setupCopyButtons(container: HTMLElement): void {
        container.querySelectorAll('.copy-button').forEach(button => {
            (button as HTMLButtonElement).addEventListener('click', async () => {
                const codeBlock = (button as HTMLElement).previousElementSibling as HTMLElement;
                const code = codeBlock.textContent || '';

                try {
                    await navigator.clipboard.writeText(code);
                    (button as HTMLButtonElement).textContent = 'Copied!';
                    button.classList.add('copied');

                    setTimeout(() => {
                        (button as HTMLButtonElement).textContent = 'Copy';
                        button.classList.remove('copied');
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy code:', err);
                    (button as HTMLButtonElement).textContent = 'Error!';

                    setTimeout(() => {
                        (button as HTMLButtonElement).textContent = 'Copy';
                    }, 2000);
                }
            });
        });
    }

    private setupColumns(container: HTMLElement): void {
        container.querySelectorAll('.columns').forEach(columns => {
            const htmlColumns = columns as HTMLElement;
            if (htmlColumns.hasAttribute('data-weights')) {
                const weights = htmlColumns.getAttribute('data-weights')?.split(' ') || [];
                htmlColumns.style.setProperty('--col-weights', weights.map(w => w).join(' '));
            } else {
                const columnCount = htmlColumns.querySelectorAll('.column').length;
                if (columnCount > 0) {
                    const weights = Array(columnCount).fill('1fr').join(' ');
                    htmlColumns.style.setProperty('--col-weights', weights);
                }
            }
        });
    }

    getSlideCount(): number {
        return this.slides.length;
    }

    getSlide(index: number): any {
        return this.slides[index] || null;
    }
}

export default SlidesRenderer;
