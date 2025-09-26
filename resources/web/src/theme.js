// Theme management class
export default class ThemeManager {
  constructor() {
    this.currentTheme = 'dark';
  }

  initialize() {
    // Get saved theme from localStorage or default to dark
    const savedTheme = localStorage.getItem('theme') || 'dark';
    this.setTheme(savedTheme);
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