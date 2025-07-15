
// Theme management class
export class ThemeManager {
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

// Create a default instance
const themeManager = new ThemeManager();

// Export both the class and convenience functions for backwards compatibility
export function initializeTheme() {
  return themeManager.initialize();
}

export function setTheme(theme) {
  return themeManager.setTheme(theme);
}

export function toggleTheme() {
  return themeManager.toggle();
}

export default themeManager;

// Initialize theme when DOM is loaded (for non-module usage)
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    // Make functions available globally for backwards compatibility
    window.ThemeManager = ThemeManager;
    window.themeManager = themeManager;
    window.initializeTheme = initializeTheme;
    window.setTheme = setTheme;
    window.toggleTheme = toggleTheme;
    
    themeManager.initialize();
    
    // Add theme toggle button event listener
    const themeToggle = document.getElementById('themeButton');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => themeManager.toggle());
    }
    
    // Set current year in footer
    const yearElement = document.getElementById('year');
    if (yearElement) {
      yearElement.textContent = new Date().getFullYear();
    }
  });
}