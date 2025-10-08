export default class CommandLine {
    constructor(lutexArticle = null) {
        this.isVisible = false;
        this.commands = new Map();
        this.lutexArticle = lutexArticle;
        this.setupCommands();
        this.createCommandBar();
        this.setupEventListeners();
        this.suggestions = [];
        this.selectedSuggestion = -1;
    }

    setupCommands() {
        // Theme toggle command
        this.commands.set('m', {
            exec: () => {
                if (window.themeManager) {
                    window.themeManager.toggle();
                }
            },
            sugg: () => [{ command: 'm', display: 'Toggle theme (dark/light)' }]
        });

        // Section navigation command
        this.commands.set('s', {
            sugg: () => this.getSectionSuggestions(),
            exec: (args) => {
                if (!args || args.length === 0) {
                    this.showSuggestions(this.commands.get('s').sugg());
                    return;
                }
                
                const sectionNum = args[0];
                
                if (sectionNum.includes('.')) {
                    // Subsection like 2.2
                    const [sec, subsec] = sectionNum.split('.');
                    const found = this.navigateToElement(`subsec-${sec}-${subsec}`, [
                        `h3[data-section="${sec}"][data-subsection="${subsec}"]`,
                        `#sec-${sec}-${subsec}`
                    ]);
                    
                    if (!found) {
                        // Fallback: find by text content
                        const allH3 = document.querySelectorAll('h3');
                        for (const h3 of allH3) {
                            if (h3.textContent.includes(`${this.getSubsecName(parseInt(subsec))}.`) || 
                                h3.textContent.includes(`${sec}.${subsec}`)) {
                                this.storeNavigationAndScroll(h3, 'start');
                                break;
                            }
                        }
                    }
                } else {
                    // Section like 2
                    const found = this.navigateToElement(`sec-${sectionNum}`, [
                        `h2[data-section="${sectionNum}"]`,
                        `#sec-${sectionNum}-0`
                    ]);
                    
                    if (!found) {
                        // Fallback: find by text content
                        const allH2 = document.querySelectorAll('h2');
                        for (const h2 of allH2) {
                            if (h2.textContent.includes(`${this.getSecName(parseInt(sectionNum))}.`) ||
                                h2.textContent.includes(`Section ${sectionNum}`)) {
                                this.storeNavigationAndScroll(h2, 'start');
                                break;
                            }
                        }
                    }
                }
            }
        });

        // Figure navigation command  
        this.commands.set('f', {
            sugg: () => this.getFigureSuggestions(),
            exec: (args) => {
                if (!args || args.length === 0) {
                    this.showSuggestions(this.commands.get('f').sugg());
                    return;
                }
                
                const figNum = args[0];
                const figEl = document.getElementById(`fig-${figNum}`) || document.querySelector(`[id*="fig"][id*="${figNum}"]`);
                if (figEl) {
                    this.storeNavigationAndScroll(figEl, 'center');
                }
            }
        });

        // Table navigation command
        this.commands.set('t', {
            sugg: () => this.getTableSuggestions(),
            exec: (args) => {
                if (!args || args.length === 0) {
                    this.showSuggestions(this.commands.get('t').sugg());
                    return;
                }
                
                const tableNum = args[0];
                const tableEl = document.getElementById(`tab-${tableNum}`) || document.querySelector(`[id*="tab"][id*="${tableNum}"]`);
                if (tableEl) {
                    this.storeNavigationAndScroll(tableEl, 'center');
                }
            }
        });

        // Equation navigation command
        this.commands.set('e', {
            sugg: () => this.getEquationSuggestions(),
            exec: (args) => {
                if (!args || args.length === 0) {
                    this.showSuggestions(this.commands.get('e').sugg());
                    return;
                }
                
                const eqNum = args[0];
                const eqEl = document.getElementById(`eq-${eqNum}`) || document.querySelector(`[id*="eq"][id*="${eqNum}"]`);
                if (eqEl) {
                    this.storeNavigationAndScroll(eqEl, 'center');
                }
            }
        });

        // Theorem navigation command
        this.commands.set('h', {
            sugg: () => this.getTheoremSuggestions(),
            exec: (args) => {
                if (!args || args.length === 0) {
                    this.showSuggestions(this.commands.get('h').sugg());
                    return;
                }
                
                const thmNum = args[0];
                const thmEl = document.getElementById(`thm-${thmNum}`) || document.querySelector(`[id*="thm"][id*="${thmNum}"]`);
                if (thmEl) {
                    this.storeNavigationAndScroll(thmEl, 'center');
                }
            }
        });

        // Checkpoint navigation command
        this.commands.set('c', {
            sugg: () => [{ command: 'c', display: 'Go to checkpoint' }],
            exec: () => {
                const checkpoints = document.querySelectorAll('.checkpoint');
                if (checkpoints.length > 0) {
                    const currentY = window.scrollY;
                    let nextCheckpoint = null;
                    
                    // Find next checkpoint after current position
                    for (const cp of checkpoints) {
                        if (cp.offsetTop > currentY + 100) {
                            nextCheckpoint = cp;
                            break;
                        }
                    }
                    
                    // If no next checkpoint, go to first one
                    if (!nextCheckpoint) {
                        nextCheckpoint = checkpoints[0];
                    }
                    
                    this.storeNavigationAndScroll(nextCheckpoint, 'center');
                }
            }
        });
    }

    createCommandBar() {
        this.commandBar = document.getElementById('command-bar');
        this.input = document.getElementById('command-input');
        this.suggestionsEl = document.getElementById('command-suggestions');
    }

    // Helper method to store navigation history and scroll
    storeNavigationAndScroll(element, block = 'start') {
        if (window.storeNavigationHistory) {
            window.storeNavigationHistory(element);
        }
        element.scrollIntoView({ behavior: 'smooth', block: block });
    }

    // Helper method to navigate to element by ID with fallback selectors
    navigateToElement(primaryId, fallbackSelectors = []) {
        const primaryEl = document.getElementById(primaryId);
        if (primaryEl) {
            this.storeNavigationAndScroll(primaryEl, 'start');
            return true;
        }
        
        for (const selector of fallbackSelectors) {
            try {
                const el = document.querySelector(selector);
                if (el) {
                    this.storeNavigationAndScroll(el, 'start');
                    return true;
                }
            } catch (e) {
                console.warn(`Invalid selector: ${selector}`);
            }
        }
        return false;
    }

    // Helper method to filter suggestions by startsWith
    filterSuggestions(suggestions, filter, cmdPrefix) {
        return suggestions.filter(s => {
            const cmdPart = s.command.replace(`${cmdPrefix} `, '');
            return cmdPart.startsWith(filter) || s.display.toLowerCase().startsWith(filter.toLowerCase());
        });
    }

    setupEventListeners() {
        // Show command bar on letter key press
        document.addEventListener('keydown', (e) => {
            // Ignore if modifier keys pressed or if already focused on input
            if (e.ctrlKey || e.altKey || e.metaKey || document.activeElement === this.input) return;
            
            // Check if a letter key was pressed
            if (e.key.length === 1 && e.key >= 'a' && e.key <= 'z') {
                e.preventDefault();
                this.show();
                this.input.value = e.key; // Set value directly instead of appending
            }
        });

        // Handle command input
        this.input.addEventListener('input', (e) => {
            const value = this.input.value.trim();
            
            // Check for commands that have suggestion functions
            const cmdPatterns = [
                { regex: /^(s)(\d+(?:\.\d+)?)?$/, cmd: 's' },
                { regex: /^(f)(\d+)?$/, cmd: 'f' },
                { regex: /^(t)(\d+)?$/, cmd: 't' },
                { regex: /^(h)(\d+)?$/, cmd: 'h' },
                { regex: /^(e)(\d+)?$/, cmd: 'e' }
            ];
            
            let foundPattern = false;
            for (const pattern of cmdPatterns) {
                const match = value.match(pattern.regex);
                if (match) {
                    const cmd = this.commands.get(pattern.cmd);
                    if (cmd && cmd.sugg) {
                        const allSuggestions = cmd.sugg();
                        if (match[2]) {
                            const filter = match[2];
                            const filtered = this.filterSuggestions(allSuggestions, filter, pattern.cmd);
                            this.showSuggestions(filtered);
                        } else {
                            this.showSuggestions(allSuggestions);
                        }
                        foundPattern = true;
                        break;
                    }
                }
            }
            
            // Also check for space-separated commands
            if (!foundPattern) {
                for (const [cmdName, cmdObj] of this.commands) {
                    if (value.startsWith(cmdName + ' ') && cmdObj.sugg) {
                        const filter = value.substring(cmdName.length + 1).trim();
                        const allSuggestions = cmdObj.sugg();
                        const filtered = this.filterSuggestions(allSuggestions, filter, cmdName);
                        this.showSuggestions(filtered);
                        foundPattern = true;
                        break;
                    } else if (value === cmdName && cmdObj.sugg) {
                        this.showSuggestions(cmdObj.sugg());
                        foundPattern = true;
                        break;
                    }
                }
            }
            
            // Hide suggestions if no pattern matched
            if (!foundPattern && this.suggestions.length > 0) {
                this.hideSuggestions();
            }
        });

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.selectedSuggestion >= 0 && this.suggestions.length > 0) {
                    const suggestion = this.suggestions[this.selectedSuggestion];
                    if (suggestion.element) {
                        // Direct navigation to element
                        this.storeNavigationAndScroll(suggestion.element, 'start');
                        this.hide();
                        return;
                    } else {
                        // Use the command from the suggestion
                        this.input.value = suggestion.command;
                        this.hideSuggestions();
                        // Execute the command
                        this.executeCommand();
                        this.hide();
                        return;
                    }
                }
                // If no suggestion selected, execute current input
                this.executeCommand();
                this.hide();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.hide();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.suggestions.length > 0) {
                    this.selectedSuggestion = Math.min(this.selectedSuggestion + 1, this.suggestions.length - 1);
                    this.updateSuggestionSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.suggestions.length > 0) {
                    this.selectedSuggestion = Math.max(this.selectedSuggestion - 1, 0);
                    this.updateSuggestionSelection();
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (this.selectedSuggestion >= 0 && this.suggestions.length > 0) {
                    const suggestion = this.suggestions[this.selectedSuggestion];
                    this.input.value = suggestion.command;
                    this.hideSuggestions();
                }
            }
        });

        // Hide when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isVisible && !this.commandBar.contains(e.target)) {
                this.hide();
            }
        });
    }

    show() {
        this.isVisible = true;
        this.commandBar.style.display = 'block';
        this.commandBar.classList.add('visible');
        this.input.focus();
    }

    hide() {
        this.isVisible = false;
        this.commandBar.classList.remove('visible');
        this.commandBar.style.display = 'none';
        this.input.value = '';
        this.input.blur();
        this.hideSuggestions();
    }

    executeCommand() {
        const input = this.input.value.trim();
        if (!input) return;

        let command = input;
        let args = [];

        // First try to match commands with spaces
        for (const [cmdName, cmdObj] of this.commands) {
            if (input.startsWith(cmdName + ' ')) {
                command = cmdName;
                const argsString = input.slice(cmdName.length).trim();
                args = argsString ? argsString.split(' ').filter(arg => arg) : [];
                break;
            } else if (input === cmdName) {
                command = cmdName;
                args = [];
                break;
            }
        }

        // If no space-separated match, try to match commands without spaces (like s3, f2)
        if (command === input && args.length === 0) {
            const patterns = [
                { regex: /^(s)(\d+(?:\.\d+)?)$/, cmd: 's' },
                { regex: /^(f)(\d+)$/, cmd: 'f' },
                { regex: /^(t)(\d+)$/, cmd: 't' },
                { regex: /^(h)(\d+)$/, cmd: 'h' },
                { regex: /^(e)(\d+)$/, cmd: 'e' }
            ];

            for (const pattern of patterns) {
                const match = input.match(pattern.regex);
                if (match) {
                    command = pattern.cmd;
                    args = [match[2]];
                    break;
                }
            }
        }

        const commandObj = this.commands.get(command);
        if (commandObj && commandObj.exec) {
            try {
                commandObj.exec(args);
            } catch (error) {
                console.error('Command execution error:', error);
            }
        }
    }

    // Helper methods for section names (matching lutexRenderer.js logic)
    getSecName(num) {
        const romanNumerals = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
        return romanNumerals[num] || num.toString();
    }

    getSubsecName(num) {
        return String.fromCharCode(64 + num); // A, B, C, D, ...
    }

    getSectionSuggestions() {
        const navigationData = this.lutexArticle?.getNavigationData() || {
            sections: [],
            subsections: []
        };
        const suggestions = [];
        
        // Add sections
        navigationData.sections.forEach(section => {
            suggestions.push({
                command: section.command,
                display: section.display,
                element: document.getElementById(section.id)
            });
        });
        
        // Add subsections
        navigationData.subsections.forEach(subsection => {
            suggestions.push({
                command: subsection.command,
                display: subsection.display,
                element: document.getElementById(subsection.id)
            });
        });
        
        return suggestions.sort((a, b) => {
            // Sort by section number, then by subsection
            const aparts = a.command.replace('s ', '').split('.');
            const bparts = b.command.replace('s ', '').split('.');
            const asec = parseInt(aparts[0]);
            const bsec = parseInt(bparts[0]);
            if (asec !== bsec) return asec - bsec;
            if (aparts.length === 1 && bparts.length === 1) return 0;
            if (aparts.length === 1) return -1;
            if (bparts.length === 1) return 1;
            return parseInt(aparts[1]) - parseInt(bparts[1]);
        });
    }

    getFigureSuggestions() {
        const navigationData = this.lutexArticle?.getNavigationData() || { figures: [] };
        return navigationData.figures.map(figure => ({
            command: figure.command,
            display: figure.display,
            element: document.getElementById(figure.id)
        })).sort((a, b) => {
            const aNum = parseInt(a.command.replace('f ', ''));
            const bNum = parseInt(b.command.replace('f ', ''));
            return aNum - bNum;
        });
    }

    getEquationSuggestions() {
        const navigationData = this.lutexArticle?.getNavigationData() || { equations: [] };
        return navigationData.equations.map(equation => ({
            command: equation.command,
            display: equation.display,
            element: document.getElementById(equation.id)
        })).sort((a, b) => {
            const aNum = parseInt(a.command.replace('e ', ''));
            const bNum = parseInt(b.command.replace('e ', ''));
            return aNum - bNum;
        });
    }

    getTableSuggestions() {
        const navigationData = this.lutexArticle?.getNavigationData() || { tables: [] };
        return navigationData.tables.map(table => ({
            command: table.command,
            display: table.display,
            element: document.getElementById(table.id)
        })).sort((a, b) => {
            const aNum = parseInt(a.command.replace('t ', ''));
            const bNum = parseInt(b.command.replace('t ', ''));
            return aNum - bNum;
        });
    }

    getTheoremSuggestions() {
        const navigationData = this.lutexArticle?.getNavigationData() || { theorems: [] };
        return navigationData.theorems.map(theorem => ({
            command: theorem.command,
            display: theorem.display,
            element: document.getElementById(theorem.id)
        }));
    }

    showSuggestions(suggestions) {
        this.suggestions = suggestions;
        this.selectedSuggestion = -1;
        
        if (suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        let html = '';
        suggestions.forEach((suggestion, index) => {
            html += `<div class="suggestion-item" data-index="${index}">${suggestion.display}</div>`;
        });
        
        this.suggestionsEl.innerHTML = html;
        this.suggestionsEl.style.display = 'block';
        this.commandBar.classList.add('has-suggestions');

        // Add click handlers
        this.suggestionsEl.querySelectorAll('.suggestion-item').forEach((item, index) => {
            item.addEventListener('click', () => {
                // If we have an element, scroll directly to it
                if (suggestions[index].element) {
                    this.storeNavigationAndScroll(suggestions[index].element, 'start');
                    this.hide();
                } else {
                    this.input.value = suggestions[index].command;
                    this.hideSuggestions();
                    this.executeCommand();
                    this.hide();
                }
            });
        });
    }

    hideSuggestions() {
        this.suggestionsEl.style.display = 'none';
        this.commandBar.classList.remove('has-suggestions');
        this.suggestions = [];
        this.selectedSuggestion = -1;
    }

    updateSuggestionSelection() {
        const items = this.suggestionsEl.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            if (index === this.selectedSuggestion) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }
}