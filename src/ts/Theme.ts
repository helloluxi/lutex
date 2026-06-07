// Extend Window interface to include custom properties
declare global {
  interface Window {
    lutexDefaultTheme?: string;
  }
}

export type ThemeType = 'light' | 'dark';
export type ThemeCallback = (isDark: boolean) => void;

/**
 * Unified Theme Manager for LuTeX extension
 * Handles theme switching for both TeX and Markdown renderers
 */
export default class ThemeManager {
  private currentTheme: ThemeType;
  private onSwitchMode: ThemeCallback | null;

  constructor(onSwitchMode: ThemeCallback | null = null) {
    this.currentTheme = 'dark';
    this.onSwitchMode = onSwitchMode;
  }

  /**
   * Initialize theme system
   * Should be called when DOM is ready
   */
  initialize(): void {
    // Wait for DOM to be ready if necessary
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.loadInitialTheme());
    } else {
      this.loadInitialTheme();
    }
  }

  /**
   * Load initial theme from storage or system preferences
   */
  private loadInitialTheme(): void {
    const savedTheme = localStorage.getItem('theme') as ThemeType | null;
    
    // Check for one-time default theme from extension settings
    if (!savedTheme && window.lutexDefaultTheme) {
      this.setTheme(window.lutexDefaultTheme as ThemeType);
      // Clean up the parameter after use
      delete window.lutexDefaultTheme;
      return;
    }

    // Use saved theme or check system preference
    if (savedTheme) {
      this.setTheme(savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.setTheme('dark');
    } else {
      this.setTheme('dark'); // Default to dark
    }
  }

  /**
   * Set the theme
   * @param theme - 'light' or 'dark'
   */
  setTheme(theme: ThemeType | string): void {
    // Normalize theme value
    const normalizedTheme: ThemeType = theme === 'light' ? 'light' : 'dark';
    this.currentTheme = normalizedTheme;

    const root = document.documentElement;
    const body = document.body;
    
    if (normalizedTheme === 'light') {
      root.setAttribute('data-theme', 'light');
      body.classList.add('light-theme');
    } else {
      root.setAttribute('data-theme', 'dark');
      body.classList.remove('light-theme');
    }
    
    // Save to localStorage
    localStorage.setItem('theme', normalizedTheme);

    // Call page-specific callback if provided
    if (this.onSwitchMode) {
      this.onSwitchMode(normalizedTheme === 'dark');
    }
  }

  /**
   * Toggle between light and dark themes
   */
  toggle(): void {
    const newTheme: ThemeType = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
  }

  /**
   * Get the current theme
   * @returns Current theme ('light' or 'dark')
   */
  getCurrentTheme(): ThemeType {
    return this.currentTheme;
  }

  /**
   * Check if current theme is dark
   * @returns true if dark theme is active
   */
  isDark(): boolean {
    return this.currentTheme === 'dark';
  }
}

// Export both as default and named export for compatibility
export { ThemeManager };
