import { useEffect, useMemo } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import type { ThemeMode } from '../stores/settingsStore';

type ResolvedTheme = 'dark' | 'light' | 'midnight' | 'crazy' | 'custom';

function resolveTheme(theme: ThemeMode): ResolvedTheme {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

/** Generate a colorful random palette — each section gets its own distinct hue */
function applyCrazyColors(root: HTMLElement) {
  const hue = () => Math.floor(Math.random() * 360);
  const sat = () => 50 + Math.floor(Math.random() * 40); // 50-90%

  // 6 distinct hues for maximum variety
  const hBg = hue();
  const hBorder = (hBg + 60 + Math.floor(Math.random() * 60)) % 360;
  const hText = (hBorder + 60 + Math.floor(Math.random() * 60)) % 360;
  const hAccent = (hText + 60 + Math.floor(Math.random() * 60)) % 360;
  const hStatus = (hAccent + 60 + Math.floor(Math.random() * 60)) % 360;
  const hChat = (hStatus + 60 + Math.floor(Math.random() * 60)) % 360;

  // Backgrounds — deep saturated tones
  root.style.setProperty('--bg-primary', `hsl(${hBg}, ${sat()}%, 10%)`);
  root.style.setProperty('--bg-secondary', `hsl(${hBg}, ${sat()}%, 14%)`);
  root.style.setProperty('--bg-tertiary', `hsl(${hBg}, ${sat()}%, 18%)`);
  root.style.setProperty('--bg-hover', `hsl(${hBg}, ${sat()}%, 24%)`);
  root.style.setProperty('--bg-active', `hsl(${hBg}, ${sat()}%, 28%)`);
  root.style.setProperty('--bg-elevated', `hsl(${hBg}, ${sat()}%, 20%)`);
  root.style.setProperty('--bg-input', `hsl(${hBg}, ${sat()}%, 12%)`);

  // Borders — different hue from bg
  root.style.setProperty('--border-color', `hsl(${hBorder}, ${sat()}%, 25%)`);
  root.style.setProperty('--border-subtle', `hsl(${hBorder}, ${sat()}%, 32%)`);
  root.style.setProperty('--border-strong', `hsl(${hBorder}, ${sat()}%, 40%)`);

  // Text — contrasting hue
  root.style.setProperty('--text-primary', `hsl(${hText}, ${sat() - 10}%, 88%)`);
  root.style.setProperty('--text-secondary', `hsl(${hText}, ${sat() - 10}%, 68%)`);
  root.style.setProperty('--text-muted', `hsl(${hText}, ${sat() - 20}%, 50%)`);

  // Accent — vivid contrasting color
  const aSat = sat() + 15;
  root.style.setProperty('--accent', `hsl(${hAccent}, ${aSat}%, 55%)`);
  root.style.setProperty('--accent-hover', `hsl(${hAccent}, ${aSat}%, 65%)`);
  root.style.setProperty('--accent-dim', `hsla(${hAccent}, ${aSat}%, 55%, 0.15)`);
  root.style.setProperty('--accent-subtle', `hsla(${hAccent}, ${aSat}%, 55%, 0.1)`);
  root.style.setProperty('--accent-timeline', `hsl(${hAccent}, ${aSat}%, 55%)`);

  // Component tokens
  root.style.setProperty('--tab-active-bg', `hsl(${hBg}, ${sat()}%, 26%)`);
  root.style.setProperty('--scrollbar-thumb', `hsl(${hBorder}, ${sat()}%, 35%)`);
  root.style.setProperty('--scrollbar-thumb-hover', `hsl(${hBorder}, ${sat()}%, 45%)`);

  // Timeline grid — accent-tinted
  root.style.setProperty('--timeline-grid-video', `hsl(${hAccent}, ${sat()}%, 16%)`);
  root.style.setProperty('--timeline-grid-audio', `hsl(${(hAccent + 120) % 360}, ${sat()}%, 16%)`);

  // Chat — its own hue
  root.style.setProperty('--chat-user-bg', `hsl(${hChat}, ${sat()}%, 22%)`);
  root.style.setProperty('--chat-user-border', `hsl(${hChat}, ${sat()}%, 30%)`);

  // Status colors — distinct from each other
  root.style.setProperty('--danger', `hsl(${hStatus}, 75%, 52%)`);
  root.style.setProperty('--success', `hsl(${(hStatus + 120) % 360}, 65%, 45%)`);
  root.style.setProperty('--warning', `hsl(${(hStatus + 50) % 360}, 75%, 52%)`);
  root.style.setProperty('--purple', `hsl(${(hStatus + 200) % 360}, 65%, 58%)`);

  // Shadows
  root.style.setProperty('--shadow-md', `0 4px 16px hsla(${hBg}, 80%, 10%, 0.5)`);
  root.style.setProperty('--shadow-lg', `0 8px 32px hsla(${hBg}, 80%, 10%, 0.5)`);
}

/** Generate a monochromatic palette from a single hue + brightness */
function applyCustomColors(root: HTMLElement, hue: number, brightness: number) {
  // brightness: 0 = very dark, 100 = very light
  // We map brightness to a base lightness for backgrounds
  const isLight = brightness > 50;
  const baseSat = 15; // subtle saturation for a professional look

  if (isLight) {
    // Light mode: backgrounds are light, text is dark
    const bgBase = 85 + (brightness - 50) * 0.3; // 85-100%
    root.style.setProperty('--bg-primary', `hsl(${hue}, ${baseSat}%, ${bgBase}%)`);
    root.style.setProperty('--bg-secondary', `hsl(${hue}, ${baseSat}%, ${bgBase - 4}%)`);
    root.style.setProperty('--bg-tertiary', `hsl(${hue}, ${baseSat}%, ${bgBase - 8}%)`);
    root.style.setProperty('--bg-hover', `hsl(${hue}, ${baseSat}%, ${bgBase - 14}%)`);
    root.style.setProperty('--bg-active', `hsl(${hue}, ${baseSat}%, ${bgBase - 18}%)`);
    root.style.setProperty('--bg-elevated', `hsl(${hue}, ${baseSat}%, ${Math.min(bgBase + 2, 100)}%)`);
    root.style.setProperty('--bg-input', `hsl(${hue}, ${baseSat}%, ${Math.min(bgBase + 2, 100)}%)`);

    root.style.setProperty('--border-color', `hsl(${hue}, ${baseSat}%, ${bgBase - 20}%)`);
    root.style.setProperty('--border-subtle', `hsl(${hue}, ${baseSat}%, ${bgBase - 12}%)`);
    root.style.setProperty('--border-strong', `hsl(${hue}, ${baseSat + 5}%, ${bgBase - 28}%)`);

    root.style.setProperty('--text-primary', `hsl(${hue}, ${baseSat + 10}%, 15%)`);
    root.style.setProperty('--text-secondary', `hsl(${hue}, ${baseSat}%, 35%)`);
    root.style.setProperty('--text-muted', `hsl(${hue}, ${baseSat - 5}%, 55%)`);

    root.style.setProperty('--tab-active-bg', `hsl(${hue}, ${baseSat}%, ${bgBase - 14}%)`);
    root.style.setProperty('--scrollbar-thumb', `hsl(${hue}, ${baseSat}%, ${bgBase - 22}%)`);
    root.style.setProperty('--scrollbar-thumb-hover', `hsl(${hue}, ${baseSat}%, ${bgBase - 30}%)`);

    root.style.setProperty('--chat-user-bg', `hsl(${hue}, ${baseSat + 8}%, ${bgBase - 10}%)`);
    root.style.setProperty('--chat-user-border', `hsl(${hue}, ${baseSat + 8}%, ${bgBase - 18}%)`);

    root.style.setProperty('--timeline-grid-video', `hsl(${hue}, ${baseSat}%, ${bgBase - 8}%)`);
    root.style.setProperty('--timeline-grid-audio', `hsl(${(hue + 30) % 360}, ${baseSat}%, ${bgBase - 8}%)`);
  } else {
    // Dark mode: backgrounds are dark, text is light
    const bgBase = 4 + brightness * 0.28; // 4-18%
    root.style.setProperty('--bg-primary', `hsl(${hue}, ${baseSat}%, ${bgBase}%)`);
    root.style.setProperty('--bg-secondary', `hsl(${hue}, ${baseSat}%, ${bgBase + 3}%)`);
    root.style.setProperty('--bg-tertiary', `hsl(${hue}, ${baseSat}%, ${bgBase + 6}%)`);
    root.style.setProperty('--bg-hover', `hsl(${hue}, ${baseSat}%, ${bgBase + 12}%)`);
    root.style.setProperty('--bg-active', `hsl(${hue}, ${baseSat}%, ${bgBase + 16}%)`);
    root.style.setProperty('--bg-elevated', `hsl(${hue}, ${baseSat}%, ${bgBase + 8}%)`);
    root.style.setProperty('--bg-input', `hsl(${hue}, ${baseSat}%, ${bgBase + 2}%)`);

    root.style.setProperty('--border-color', `hsl(${hue}, ${baseSat}%, ${bgBase + 12}%)`);
    root.style.setProperty('--border-subtle', `hsl(${hue}, ${baseSat}%, ${bgBase + 18}%)`);
    root.style.setProperty('--border-strong', `hsl(${hue}, ${baseSat + 5}%, ${bgBase + 25}%)`);

    root.style.setProperty('--text-primary', `hsl(${hue}, ${baseSat - 5}%, 88%)`);
    root.style.setProperty('--text-secondary', `hsl(${hue}, ${baseSat - 5}%, 65%)`);
    root.style.setProperty('--text-muted', `hsl(${hue}, ${baseSat - 8}%, 48%)`);

    root.style.setProperty('--tab-active-bg', `hsl(${hue}, ${baseSat}%, ${bgBase + 14}%)`);
    root.style.setProperty('--scrollbar-thumb', `hsl(${hue}, ${baseSat}%, ${bgBase + 20}%)`);
    root.style.setProperty('--scrollbar-thumb-hover', `hsl(${hue}, ${baseSat}%, ${bgBase + 28}%)`);

    root.style.setProperty('--chat-user-bg', `hsl(${hue}, ${baseSat + 8}%, ${bgBase + 10}%)`);
    root.style.setProperty('--chat-user-border', `hsl(${hue}, ${baseSat + 8}%, ${bgBase + 18}%)`);

    root.style.setProperty('--timeline-grid-video', `hsl(${hue}, ${baseSat}%, ${bgBase + 6}%)`);
    root.style.setProperty('--timeline-grid-audio', `hsl(${(hue + 30) % 360}, ${baseSat}%, ${bgBase + 6}%)`);
  }

  // Accent — always vivid, based on hue
  const accentSat = 70;
  const accentLight = isLight ? 45 : 55;
  root.style.setProperty('--accent', `hsl(${hue}, ${accentSat}%, ${accentLight}%)`);
  root.style.setProperty('--accent-hover', `hsl(${hue}, ${accentSat}%, ${accentLight + 10}%)`);
  root.style.setProperty('--accent-dim', `hsla(${hue}, ${accentSat}%, ${accentLight}%, 0.15)`);
  root.style.setProperty('--accent-subtle', `hsla(${hue}, ${accentSat}%, ${accentLight}%, 0.1)`);
  root.style.setProperty('--accent-timeline', `hsl(${hue}, ${accentSat}%, ${accentLight}%)`);

  // Shadows
  root.style.setProperty('--shadow-md', `0 4px 16px hsla(${hue}, 30%, 5%, ${isLight ? 0.12 : 0.5})`);
  root.style.setProperty('--shadow-lg', `0 8px 32px hsla(${hue}, 30%, 5%, ${isLight ? 0.15 : 0.5})`);
}

/** Remove all inline style overrides set by crazy/custom theme */
function clearInlineColors(root: HTMLElement) {
  const props = [
    '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover', '--bg-active',
    '--bg-elevated', '--bg-input', '--border-color', '--border-subtle', '--border-strong',
    '--text-primary', '--text-secondary', '--text-muted', '--accent', '--accent-hover',
    '--accent-dim', '--accent-subtle', '--accent-timeline', '--tab-active-bg',
    '--scrollbar-thumb', '--scrollbar-thumb-hover', '--timeline-grid-video',
    '--timeline-grid-audio', '--chat-user-bg', '--chat-user-border',
    '--danger', '--success', '--warning', '--purple', '--shadow-md', '--shadow-lg',
  ];
  for (const prop of props) {
    root.style.removeProperty(prop);
  }
}

export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const customHue = useSettingsStore((s) => s.customHue);
  const customBrightness = useSettingsStore((s) => s.customBrightness);

  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const resolved = resolveTheme(theme);

    // Clear any inline overrides before switching
    clearInlineColors(root);

    // Add transition class for smooth switching
    root.classList.add('theme-transitioning');
    root.dataset.theme = resolved;

    if (theme === 'crazy') {
      applyCrazyColors(root);
    } else if (theme === 'custom') {
      applyCustomColors(root, customHue, customBrightness);
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => root.classList.remove('theme-transitioning'));
    });

    // Listen for OS changes when in system mode
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        root.dataset.theme = resolveTheme(theme);
      };
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, [theme, customHue, customBrightness]);

  return { theme, resolvedTheme, setTheme };
}
