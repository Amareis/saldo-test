import { Store } from '../lib/store';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'saldo-theme';

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function apply(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}

/**
 * Color theme, class-store style like ChatStore. Persisted to localStorage —
 * a UI preference, not chat data, so this doesn't contradict our
 * "history dies with the tab" decision (see README).
 */
export class ThemeStore extends Store<{ theme: Theme }> {
  constructor() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const theme: Theme = saved === 'dark' || saved === 'light' ? saved : systemTheme();
    super({ theme });
    apply(theme);
  }

  toggle(): void {
    const theme: Theme = this.getSnapshot().theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode etc. — the theme still applies for the session.
    }
    apply(theme);
    this.updateState({ theme });
  }
}

export const themeStore = new ThemeStore();
