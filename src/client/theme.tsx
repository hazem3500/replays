import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AnimatedIcon } from '@/components/animated-icon.tsx';

import { flushSync } from 'react-dom';

import { IconButton } from '@/components/icon-button.tsx';
import { cn } from '@/lib/utils.ts';

export type Theme = 'light' | 'dark';
/** A fixed theme once the person flips it; until then, follow the OS. */
type ThemePreference = Theme | 'system';

export const THEME_KEY = 'replays-theme';
/**
 * Built-in browser chrome colour per theme (`<meta name="theme-color">`), the default `--page` of styles.css. A themed
 * deployment's own `page` colours ride on the meta's `data-dark` / `data-light` (stamped by the server), and win.
 */
export const THEME_COLORS: Record<Theme, string> = { dark: '#0c0e12', light: '#eff1f5' };

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function savedPreference(): ThemePreference {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

function systemTheme(): Theme {
  return matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(savedPreference);
  const [system, setSystem] = useState<Theme>(() => {
    // index.html's inline script has already resolved it before first paint.
    const applied = document.documentElement.dataset.theme;
    return savedPreference() === 'system' && (applied === 'light' || applied === 'dark') ? applied : systemTheme();
  });
  const theme: Theme = preference === 'system' ? system : preference;

  useEffect(() => {
    const query = matchMedia(LIGHT_QUERY);
    const onChange = () => setSystem(query.matches ? 'light' : 'dark');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!themeColor) {
      themeColor = document.createElement('meta');
      themeColor.name = 'theme-color';
      document.head.append(themeColor);
    }
    themeColor.content = themeColor.getAttribute(`data-${theme}`) || THEME_COLORS[theme];
  }, [theme]);

  useEffect(() => {
    if (preference === 'system') return;
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Private modes can refuse storage; the theme still applies for this page.
    }
  }, [preference]);

  /** Flips light ↔ dark. Until the first flip the theme follows the OS preference. */
  const switchTheme = useCallback(() => {
    const apply = () => setPreferenceState(theme === 'dark' ? 'light' : 'dark');
    // A 180 ms crossfade of the whole page (View Transitions) where supported and motion is welcome.
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.dataset.themeSwitching = 'true';
      const transition = document.startViewTransition(() => flushSync(apply));
      void transition.finished.finally(() => delete document.documentElement.dataset.themeSwitching);
      return;
    }
    // Otherwise swap every colour at once instead of letting hover transitions smear the change.
    const blocker = document.createElement('style');
    blocker.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.append(blocker);
    apply();
    requestAnimationFrame(() => {
      void document.documentElement.offsetHeight;
      requestAnimationFrame(() => blocker.remove());
    });
  }, [theme]);

  return useMemo(() => ({ theme, switchTheme }), [switchTheme, theme]);
}

export interface ThemeControls {
  theme: Theme;
  switchTheme: () => void;
}

export const ThemeContext = createContext<ThemeControls>({ theme: 'dark', switchTheme: () => undefined });

export function useThemeControls() {
  return useContext(ThemeContext);
}

/** Sun ↔ moon icon button; the glyph shows the theme you switch to and swaps with a short scale + blur. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { theme, switchTheme } = useThemeControls();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      className={cn('theme-switch', className)}
      label={`Switch to ${next} theme`}
      tooltipSide="bottom"
      tooltipAlign="end"
      onClick={switchTheme}
    >
      <span className="icon-swap" data-state={theme === 'dark' ? 'a' : 'b'} aria-hidden="true">
        {/* Each plays when it appears and on hover / keyboard navigation (sun: rays turn in; moon: a tilt). */}
        <AnimatedIcon name="sun" className="icon-a" trigger="state" hover play={theme === 'dark' ? 'dark' : false} />
        <AnimatedIcon name="moon" className="icon-b" trigger="state" hover play={theme === 'light' ? 'light' : false} />
      </span>
    </IconButton>
  );
}
