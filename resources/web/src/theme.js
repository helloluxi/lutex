// Theme management class
export default class ThemeManager {
  constructor() {
    this.currentTheme = 'dark';
  }

  initialize() {
    // Get saved theme from localStorage, or use default theme from settings (one-time), or default to dark
    const savedTheme = localStorage.getItem('theme');
    
    if (!savedTheme && window.lutexDefaultTheme) {
      // One-time use of default theme from URL parameter
      this.setTheme(window.lutexDefaultTheme);
      // Clean up the parameter after use
      delete window.lutexDefaultTheme;
    } else {
      this.setTheme(savedTheme || 'dark');
    }
  }

  setTheme(theme) {
    const root = document.documentElement;
    const body = document.body;
    
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
      body.classList.add('light-theme');
    } else {
      root.removeAttribute('data-theme');
      body.classList.remove('light-theme');
    }
    
    this.currentTheme = theme;
    localStorage.setItem('theme', theme);
  }

  toggle() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme);
  }

  getCurrentTheme() {
    return this.currentTheme;
  }
}