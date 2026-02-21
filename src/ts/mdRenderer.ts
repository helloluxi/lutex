/**
 * Renders markdown with math support using KaTeX
 * @param markdown - The markdown content as string
 * @param element - The HTML element to render the content into
 * @param katexMacros - Custom KaTeX macros object (optional, defaults to basic macros)
 * @param markdownFilePath - Path to the markdown file for resolving relative image paths (optional)
 * @returns Promise that resolves when rendering is complete
 */
export async function renderMarkdownWithMath(markdown: string, element: HTMLElement, katexMacros?: { [key: string]: string }, markdownFilePath?: string): Promise<void> {
    // Use provided macros or default to basic set
    const macros = katexMacros || {
        "\\ket": "\\lvert #1 \\rangle",
        "\\bra": "\\langle #1 \\rvert", 
        "\\ip": "\\langle #1 | #2 \\rangle",
        "\\dyad": "\\ket{#1} \\bra{#2}"
    };
    
    // Render markdown first
    element.innerHTML = renderMarkdown(markdown.split('\n'), markdownFilePath);
    
    // Wait for KaTeX to be ready (loaded from HTML) and render math
    try {
        await (window as any).katexReady;
        (window as any).renderMathInElement(element, {
            delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
            ],
            macros: macros,
            throwOnError: false,
            errorColor: '#cc0000',
            strict: false
        });
    } catch (error) {
        console.warn('Failed to render KaTeX:', error);
    }
    
    // Update document title from first h1 element
    if (typeof document !== 'undefined') {
        const h1Element = element.querySelector('h1');
        if (h1Element && h1Element.textContent) {
            document.title = h1Element.textContent.trim();
        }
    }
}

/**
 * Takes array of lines and returns rendered HTML
 * @param lines - Array of markdown lines
 * @param markdownFilePath - Path to the markdown file for resolving relative image paths (optional)
 */
export const renderMarkdown = (function() {
    // Global number counter that persists across renders
    let globalNumberCounter = 1;
    
    // Helper function to process inline markdown (code and URLs)
    function processInlineMarkdown(line: string, markdownFileDir: string) {
        let processedLine = line;
        
        // Process inline code: `code`
        processedLine = processedLine.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Process images: ![alt](path) - must be before links since similar syntax
        processedLine = processedLine.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, imgPath) => {
            // Use project-root-relative paths (paths already relative to project root)
            // Allow absolute URLs (http://, https://) and absolute paths (/)
            return `<img src="${imgPath}" alt="${alt}">`;
        });
        
        // Process markdown links: [text](url)
        processedLine = processedLine.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // Process strong text: **text**
        processedLine = processedLine.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        
        // Process URLs: automatically link https:// URLs (but skip if already in href attribute)
        processedLine = processedLine.replace(/(?<!href="|src=")(https:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank">$1</a>');
        
        return processedLine;
    }
    
    // Helper function to render paragraph content
    function renderParaContent(paraLines: string[], markdownFileDir: string, startLine: number, markdownFile: string) {
        if (paraLines.length === 0) return '';
        
        let tmpHtml = `<div class="para" line="${startLine + 1}">`;
        let lastListLevel = -1;
        let cachedLines: string[] = [];

        const closeList = () => {
            if (lastListLevel >= 0) {
                for (let i = 0; i <= lastListLevel; i++) {
                    tmpHtml += `</ul>`;
                }
                lastListLevel = -1;
            }
        };

        const renderCachedLines = () => {
            const joinedLines = cachedLines.join(' ').trim();
            if (joinedLines.length === 0) return;
            tmpHtml += `<p>${joinedLines}</p>`;
            cachedLines = [];
        };

        for (let line of paraLines) {
            let trimmedLine = line.trim();
            
            if (trimmedLine.startsWith('+ ') || trimmedLine.startsWith('- ')) {
                if (lastListLevel === -1) {
                    renderCachedLines();
                }

                let thisListLevel = (line.match(/^ */) || [''])[0].length >> 1;

                if (thisListLevel < lastListLevel) {
                    for (let i = 0; i < lastListLevel - thisListLevel; i++) {
                        tmpHtml += `</ul>`;
                    }
                }

                if (thisListLevel > lastListLevel) {
                    for (let i = 0; i < thisListLevel - lastListLevel; i++) {
                        tmpHtml += `<ul>`;
                    }
                }

                // Parse checkbox
                trimmedLine = trimmedLine.substring(2).trim();
                trimmedLine = trimmedLine.replace(/^\[([x\s]?)\]/, (match, content) => {
                    const isChecked = content === 'x' ? ' checked' : '';
                    return `<input type="checkbox"${isChecked}> `;
                });

                // Add number for + items, keep - items as is
                const processedLine = processInlineMarkdown(trimmedLine, markdownFileDir);
                if (line.trim().startsWith('+ ')) {
                    tmpHtml += `<li>${globalNumberCounter++}. ${processedLine}</li>`;
                } else {
                    tmpHtml += `<li>${processedLine}</li>`;
                }
                lastListLevel = thisListLevel;
                continue;
            }

            closeList();
            
            // Process inline markdown for regular lines
            const processedLine = processInlineMarkdown(line, markdownFileDir);
            cachedLines.push(processedLine);
        }
        
        closeList();
        renderCachedLines();
        tmpHtml += '</div>';
        return tmpHtml;
    }
    
    // Helper function to render heading with line attribute
    function renderHeading(line: string, lineIndex: number, markdownFile: string) {
        const trimmedLine = line.trim();
        
        if (trimmedLine.startsWith('# ')) {
            const headingText = trimmedLine.substring(2).trim();
            return `<h1 line="${lineIndex + 1}">${headingText}</h1>`;
        } else if (trimmedLine.startsWith('## ')) {
            const headingText = trimmedLine.substring(3).trim();
            return `<h2 line="${lineIndex + 1}">${headingText}</h2>`;
        } else if (trimmedLine.startsWith('### ')) {
            const headingText = trimmedLine.substring(4).trim();
            return `<h3 line="${lineIndex + 1}">${headingText}</h3>`;
        }
        
        return '';
    }

    function escapeHtml(text: string) {
        return text.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');
    }
    
    // Helper function to render code block
    function renderCodeBlock(codeLines: string[], language: string) {
        const codeContent = codeLines.join('\n');
        return `<pre><code class="lang-${language}">${escapeHtml(codeContent)}</code></pre>`;
    }
    
    // Main rendering function
    return function(lines: string[], markdownFilePath?: string): string {
        if (!lines || lines.length === 0) return '';
                // Extract directory from markdown file path
        let markdownFileDir = '';
        if (markdownFilePath) {
            const lastSlash = markdownFilePath.lastIndexOf('/');
            if (lastSlash >= 0) {
                markdownFileDir = markdownFilePath.substring(0, lastSlash + 1);
            }
        }
        const markdownFile = markdownFilePath || '';
                let html = '';
        let currentPara: string[] = [];
        let currentParaStartLine = 0;
        let inCodeBlock = false;
        let codeBlockLang = '';
        let codeBlockLines: string[] = [];
        globalNumberCounter = 1;
        
        // Main rendering loop
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmedLine = line.trim();
            
            // Handle \resetnumber command
            if (trimmedLine === '\\resetnumber') {
                globalNumberCounter = 1;
                continue;
            }
            
            // Handle code blocks
            if (trimmedLine.startsWith('```') && !inCodeBlock) {
                // Start of code block
                if (currentPara.length > 0) {
                    html += renderParaContent(currentPara, markdownFileDir, currentParaStartLine, markdownFile);
                    currentPara = [];
                }
                inCodeBlock = true;
                codeBlockLang = trimmedLine.substring(3).trim();
                codeBlockLines = [];
                continue;
            } else if (trimmedLine.startsWith('```') && inCodeBlock) {
                // End of code block
                html += renderCodeBlock(codeBlockLines, codeBlockLang);
                inCodeBlock = false;
                codeBlockLang = '';
                codeBlockLines = [];
                continue;
            }
            
            if (inCodeBlock) {
                codeBlockLines.push(line);
                continue;
            }
            
            // Check if line is a heading (h1, h2, h3)
            if (trimmedLine.match(/^#{1,3} /)) {
                // Render any accumulated paragraph content first
                if (currentPara.length > 0) {
                    html += renderParaContent(currentPara, markdownFileDir, currentParaStartLine, markdownFile);
                    currentPara = [];
                }
                
                // Render heading as direct child with line attribute
                html += renderHeading(line, lineIndex, markdownFile);
            } else if (trimmedLine === '') {
                // Empty line - check if we should close current paragraph
                if (currentPara.length > 0) {
                    html += renderParaContent(currentPara, markdownFileDir, currentParaStartLine, markdownFile);
                    currentPara = [];
                }
            } else {
                // Regular content line - add to current paragraph
                if (currentPara.length === 0) {
                    currentParaStartLine = lineIndex;
                }
                currentPara.push(line);
            }
        }
        
        // Handle any remaining paragraph content
        if (currentPara.length > 0) {
            html += renderParaContent(currentPara, markdownFileDir, currentParaStartLine, markdownFile);
        }
        
        // Handle unclosed code block
        if (inCodeBlock && codeBlockLines.length > 0) {
            html += renderCodeBlock(codeBlockLines, codeBlockLang);
        }
        
        return html;
    };
})();
