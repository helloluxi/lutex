// @ts-nocheck
import LutexArticle from './texRenderer.js';
import ThemeManager from './Theme.js';
import CommandLine  from './lutexCmd.js';

// Extend Window interface to include custom properties
declare global {
  interface Window {
    lutex: LutexArticle;
    themeManager: ThemeManager;
    lutexListenerPort?: number;
    commandLine?: CommandLine;
    storeNavigationHistory?: (targetElement: Element) => void;
  }
  function renderMathInElement(element: HTMLElement, options: any): void;
}

const themeManager = new ThemeManager();
const lutex = new LutexArticle();
let commandLine = new CommandLine(); // Will be updated after rendering

window.lutex = lutex;
window.themeManager = themeManager;

// Helper function to update URL parameter
function updateUrlThemeParam(theme: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('m', theme);
    window.history.replaceState({}, '', url);
}

// Initialize theme from URL param only
const urlParams = new URLSearchParams(window.location.search);
const themeFromUrl = urlParams.get('m') || 'dark'; // Default to dark if not specified
themeManager.setTheme(themeFromUrl);
if (window.lutexDefaultTheme) {
    delete window.lutexDefaultTheme;
}

// ===== TOOLTIP FUNCTIONS =====
// Utility functions for tooltips
function showTooltip(element, event) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.textContent = element.getAttribute('data-tooltip');
    document.body.appendChild(tooltip);

    const rect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = event.clientX - rect.width / 2;
    let top = event.clientY - rect.height - 20;

    // Adjust if tooltip would go off the right edge
    if (left + rect.width > viewportWidth) {
        left = viewportWidth - rect.width - 10;
    }

    // Adjust if tooltip would go off the left edge
    if (left < 0) {
        left = 10;
    }

    // Adjust if tooltip would go off the top
    if (top < 0) {
        top = event.clientY + 20;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.display = 'block';
}

function hideTooltip() {
    const tooltip = document.querySelector('.tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

// Update tooltip position on mouse move
document.addEventListener('mousemove', (e) => {
    const tooltip = document.querySelector('.tooltip');
    if (tooltip) {
        const rect = tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = e.clientX - rect.width / 2;
        let top = e.clientY - rect.height - 20;

        // Adjust if tooltip would go off the right edge
        if (left + rect.width > viewportWidth) {
            left = viewportWidth - rect.width - 10;
        }

        // Adjust if tooltip would go off the left edge
        if (left < 0) {
            left = 10;
        }

        // Adjust if tooltip would go off the top
        if (top < 0) {
            top = e.clientY + 20;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }
});

// ===== PROOF PANEL FUNCTIONS =====
// Proof panel toggle function
function toggleProof(panel, pfKey) {
    panel.classList.toggle('collapsed');
    panel.classList.toggle('expanded');
    localStorage.setItem(pfKey, panel.classList.contains('expanded'));
}

function setupToggleProof() {
    const proofToggles = document.querySelectorAll('.proof-toggle');
    proofToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = toggle.parentElement;
            const pfLabel = toggle.getAttribute('data-label');
            if (pfLabel) {
                const pfKey = `latex.${toggle.getAttribute('data-label')}`;
                toggleProof(panel, pfKey);
            }
        });
    });

    // Restore proof panel state from localStorage
    document.querySelectorAll('.proof-panel').forEach(panel => {
        const pfKey = `latex.${panel.querySelector('.proof-toggle').getAttribute('data-label')}`;
        const isExpanded = localStorage.getItem(pfKey) === 'true';
        if (isExpanded) {
            panel.classList.remove('collapsed');
            panel.classList.add('expanded');
        } else {
            panel.classList.remove('expanded');
            panel.classList.add('collapsed');
        }
    });
}

// ===== CONTENT RENDERING =====
// Fetch and render content
async function render() {
    try {
        await lutex.render('main.tex');
        
        // Initialize command line with lutex instance after rendering
        commandLine = new CommandLine(lutex);
        window.commandLine = commandLine;
        
        // Render math after all content is loaded
        try {
            renderMathInElement(document.body, {
                ...window.katexOptions,
                output: 'html',
                strict: false,
                trust: true,
                throwOnError: false,
                displayMode: true
            });
            console.log('KaTeX rendering complete');
        } catch (error) {
            console.error('KaTeX rendering error:', error);
        }

        setupToggleProof();
        setupScrollTracking();
        setupCiteHover();
        setupLocalhostJump();
        setupAutorefNavigation();
    } catch (error) {
        console.error('Error rendering content:', error);
    }
}

// ===== SCROLL POSITION MANAGEMENT =====
// Save position before unloading the page
window.addEventListener('beforeunload', () => {
    localStorage.setItem('scroll', window.scrollY);
});

// Scroll to element based on file and line attributes
function scrollToElement(file, line) {
    // Find all elements with matching file attribute
    const allElements = document.querySelectorAll(`[file="${file}"][line]`);
    
    if (allElements.length === 0) {
        console.log(`No elements found for file="${file}"`);
        return;
    }
    
    // Find the element with the closest line number that's no less than the requested one
    let targetElement = null;
    let closestLine = Infinity;
    
    allElements.forEach(element => {
        const elementLine = parseInt(element.getAttribute('line'), 10);
        if (elementLine >= line && elementLine < closestLine) {
            closestLine = elementLine;
            targetElement = element;
        }
    });
    
    if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Optional: Add a highlight effect
        targetElement.style.transition = 'background-color 0.3s';
        const originalBg = targetElement.style.backgroundColor;
        targetElement.style.backgroundColor = 'var(--accent-color, rgba(255, 255, 0, 0.3))';
        setTimeout(() => {
            targetElement.style.backgroundColor = originalBg;
        }, 1000);
        
        console.log(`Scrolled to file="${file}" line="${closestLine}" (requested: ${line})`);
    } else {
        console.log(`No element found for file="${file}" with line >= ${line}`);
    }
}

// ===== INITIALIZATION =====
// Scroll position tracking
function setupScrollTracking() {
    // Add a small delay to ensure all content is fully rendered
    setTimeout(() => {
        const savedPosition = localStorage.getItem('scroll');
        if (savedPosition !== null) {
            window.scrollTo(0, parseInt(savedPosition, 10));
        }
    }, 100);

    // Set up scroll position tracking with navigation history
    let isNavigating = false;

    // Helper functions for navigation history
    function storeNavigationPair(fromPosition, toPosition) {
        localStorage.setItem('naviback', fromPosition);
        localStorage.setItem('naviforth', toPosition);
    }

    // Make navigation history function globally available
    window.storeNavigationHistory = function(targetElement) {
        const fromPosition = window.scrollY;
        const toPosition = targetElement.offsetTop;
        storeNavigationPair(fromPosition, toPosition);
    };

    function navigateToStoredPosition(direction) {
        const key = direction === 1 ? 'naviforth' : 'naviback';
        const targetPosition = localStorage.getItem(key);
        
        if (targetPosition !== null) {
            const position = parseInt(targetPosition, 10);
            isNavigating = true;
            
            window.scrollTo({
                top: position,
                behavior: 'smooth'
            });

            // Save the new position
            localStorage.setItem('scroll', position);
            
            setTimeout(() => { isNavigating = false; }, 1000);
        }
    }

    // Save scroll position periodically (simplified without previous tracking)
    let scrollTimer;
    window.addEventListener('scroll', () => {
        if (isNavigating) return;

        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            localStorage.setItem('scroll', window.scrollY);
        }, 1000);
    });

    // Handle mouse back/forward buttons
    window.addEventListener('mouseup', (e) => {
        if (e.button === 3) { // Back button
            e.preventDefault();
            navigateToStoredPosition(-1);
        } else if (e.button === 4) { // Forward button
            e.preventDefault();
            navigateToStoredPosition(1);
        }
    });

    // Handle keyboard shortcuts (Alt + Left/Right)
    window.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            navigateToStoredPosition(-1);
        } else if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            navigateToStoredPosition(1);
        }
    });
    
    // ===== LISTENER INTEGRATION =====
    // Only enable listener if 'o' parameter is present in URL (indicating VSCode launched server)
    const listenerPort = window.lutexListenerPort || lutex.localHostPort;
    
    if (listenerPort && listenerPort !== 0) {
        console.log('[LuTeX] Listener integration enabled:', { listenerPort, hostname: window.location.hostname });
        // Use current hostname instead of hardcoding localhost for LAN support
        const listenerHost = window.location.hostname;
        
        // Function to send jump request
        const sendJumpRequest = (element: Element, action: string = 'jump') => {
            const file = element.getAttribute('file');
            const line = element.getAttribute('line');
            console.log('[LuTeX] Double-click detected:', { file, line, action, element });
            if (!file || !line) {
                console.warn('[LuTeX] Element missing file or line attribute');
                return;
            }
            const url = `http://${listenerHost}:${listenerPort}`;
            const payload = { file, line, action };
            console.log('[LuTeX] Sending request to:', url, 'with payload:', payload);
            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            })
            .then(response => {
                console.log('[LuTeX] Request successful:', response.status);
            })
            .catch(error => {
                console.error('[LuTeX] Error sending request:', error);
            });
        };
        
        // Add double-click handler for desktop
        document.addEventListener('dblclick', (e) => {
            let element = e.target;
            while (element && !element.hasAttribute('line')) {
                element = element.parentElement;
            }
            if (element) {
                sendJumpRequest(element);
            }
        });
        
        // Add touch handler for mobile/tablet (detect double-tap)
        let lastTap = 0;
        let lastTapElement: Element | null = null;
        document.addEventListener('touchend', (e) => {
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTap;
            
            let element = e.target;
            while (element && !element.hasAttribute('line')) {
                element = element.parentElement;
            }
            
            if (element && tapLength < 500 && tapLength > 0 && element === lastTapElement) {
                // Double-tap detected
                e.preventDefault();
                sendJumpRequest(element);
                lastTap = 0; // Reset to prevent triple-tap triggering
            } else {
                lastTap = currentTime;
                lastTapElement = element;
            }
        });
        
        // Set up auto-refresh listener
        const eventSource = new EventSource(`http://${listenerHost}:${listenerPort}/event`);
        eventSource.addEventListener('message', (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'refresh') {
                    location.reload();
                } else if (data.type === 'scroll') {
                    scrollToElement(data.file, data.line);
                }
            } catch (error) {
                console.error('Error processing refresh event:', error);
            }
        });
    } else {
        console.log('[LuTeX] Listener integration disabled:', { listenerPort, lutexListenerPort: window.lutexListenerPort });
    }
}

// Setup localhost jump for equation labels
function setupLocalhostJump() {
    // Only enable if listener integration is available (indicated by lutexListenerPort)
    const listenerPort = window.lutexListenerPort;
    if (listenerPort && listenerPort !== 0) {
        // Add click handlers for equation numbers (KaTeX generates these)
        document.addEventListener('click', (e) => {
            // Check if clicked element or its parent is an equation number
            let target = e.target;
            let equationElement = null;
            
            // Look for the equation container that has an id like "eq-X"
            while (target && target !== document.body) {
                if (target.id && target.id.match(/^eq-\d+$/)) {
                    equationElement = target;
                    break;
                }
                target = target.parentElement;
            }
            
            if (!equationElement) return;
            
            // Check if we clicked specifically on an equation number (more precise detection)
            const clickedText = e.target.textContent || '';
            const isEquationNumber = (
                // Direct equation number like "(1)" or "(53)"
                clickedText.match(/^\(\d+\)$/) ||
                // Equation number in a tag element (KaTeX renders these with specific classes)
                (e.target.classList.contains('tag') && clickedText.match(/\(\d+\)/)) ||
                // Check if it's a KaTeX equation number element
                (e.target.classList.contains('eqn-num') || 
                 e.target.parentElement?.classList.contains('eqn-num'))
            );
            
            if (isEquationNumber) {
                e.preventDefault(); // Prevent any default behavior
                
                const dataLabel = equationElement.getAttribute('data-label');
                
                // Create hint element
                const hint = document.createElement('div');
                hint.className = 'eqn-hint';
                document.body.appendChild(hint);

                // Position hint near the clicked element
                const rect = e.target.getBoundingClientRect();
                hint.style.position = 'fixed';
                hint.style.right = '10px';
                hint.style.top = `${rect.top - 30}px`;
                hint.style.zIndex = '9999';

                if (!dataLabel || dataLabel === equationElement.id) {
                    hint.textContent = 'No Label';
                    hint.style.color = '#ff9800';
                } else {
                    hint.textContent = `Copied: ${dataLabel}`;
                    // Color will be handled by CSS theme variables
                    navigator.clipboard.writeText(dataLabel).catch(() => {
                        hint.textContent = `Label: ${dataLabel}`;
                    });
                }

                setTimeout(() => {
                    hint.style.opacity = '1';
                }, 10);
                setTimeout(() => {
                    hint.style.opacity = '0';
                    setTimeout(() => {
                        if (hint.parentNode) {
                            document.body.removeChild(hint);
                        }
                    }, 300);
                }, 1500);
            }
        });
    }
}

// Setup citation hover tooltips
function setupCiteHover() {
    document.querySelectorAll('.citation').forEach(el => {
        el.addEventListener('mouseover', (e) => showTooltip(el, e));
        el.addEventListener('mouseout', hideTooltip);
    });
}

// Setup autoref navigation with history tracking
function setupAutorefNavigation() {
    document.querySelectorAll('.autoref').forEach(link => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href');
            if (href && href.startsWith('#')) {
                const targetId = href.substring(1);
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    e.preventDefault(); // Prevent default anchor behavior
                    
                    // Store navigation history
                    const fromPosition = window.scrollY;
                    const toPosition = targetElement.offsetTop;
                    localStorage.setItem('naviback', fromPosition);
                    localStorage.setItem('naviforth', toPosition);
                    
                    // Navigate to target
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    });
}

render();