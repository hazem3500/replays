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

/**
 * Writes a theme to the document in one go: `data-theme` (which carries `color-scheme` and every token) and the
 * browser chrome colour, so the page and the phone's bar change in the same frame.
 */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    document.head.append(themeColor);
  }
  themeColor.content = themeColor.getAttribute(`data-${theme}`) || THEME_COLORS[theme];
}

/** Holds every element's own transitions while the theme swaps, so hovers and fills never smear between themes. */
function holdTransitions() {
  const blocker = document.createElement('style');
  blocker.dataset.themeSwitch = '';
  blocker.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(blocker);
  return () => {
    void document.documentElement.offsetHeight;
    requestAnimationFrame(() => blocker.remove());
  };
}

/** Where the reveal grows from: the pointer's point, else the middle of the control that was activated. */
export interface ThemeSwitchOrigin {
  clientX: number;
  clientY: number;
  currentTarget?: EventTarget | null;
}

function revealFrom(origin: ThemeSwitchOrigin | undefined) {
  if (!origin) return;
  if (origin.clientX || origin.clientY) return { x: origin.clientX, y: origin.clientY };
  if (!(origin.currentTarget instanceof Element)) return;
  const box = origin.currentTarget.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function systemTheme(): Theme {
  if (typeof matchMedia === 'undefined') return 'dark';
  return matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark';
}

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(savedPreference);
  const [system, setSystem] = useState<Theme>(() => {
    // index.html's inline script has already resolved it before first paint.
    const applied = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
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
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (preference === 'system') return;
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Private modes can refuse storage; the theme still applies for this page.
    }
  }, [preference]);

  /**
   * Flips light ↔ dark (until the first flip the theme follows the OS). The new theme reveals in a circle from the
   * toggle (or the tap) where View Transitions run, crossfades without an origin, and swaps at once under reduced
   * motion; in every case the document, `color-scheme` and the chrome colour change together, element transitions held.
   */
  const switchTheme = useCallback(
    (origin?: ThemeSwitchOrigin) => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark';
      const apply = () => {
        applyTheme(next);
        setPreferenceState(next);
      };
      const release = holdTransitions();
      const root = document.documentElement;
      if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const point = revealFrom(origin);
        root.dataset.themeSwitching = point ? 'reveal' : 'fade';
        if (point) {
          root.style.setProperty('--theme-x', `${point.x}px`);
          root.style.setProperty('--theme-y', `${point.y}px`);
          root.style.setProperty(
            '--theme-r',
            `${Math.hypot(Math.max(point.x, innerWidth - point.x), Math.max(point.y, innerHeight - point.y))}px`,
          );
        }
        const transition = document.startViewTransition(() => flushSync(apply));
        void transition.finished.finally(() => {
          delete root.dataset.themeSwitching;
          release();
        });
        return;
      }
      apply();
      release();
    },
    [theme],
  );

  return useMemo(() => ({ theme, switchTheme }), [switchTheme, theme]);
}

export interface ThemeControls {
  theme: Theme;
  /** Pass the click (or tap) so the new theme reveals from it. */
  switchTheme: (origin?: ThemeSwitchOrigin) => void;
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
