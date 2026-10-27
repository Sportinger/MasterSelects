// Light or dark phone palette for the editor theme. The phone keeps its own --phone-* tokens
// (PhoneApp.css); the root carries data-phone-scheme so every light editor theme gets the light
// tokens: Light, System while the device is light, and a bright Custom theme.

import { useSyncExternalStore } from 'react';
import { isCustomThemeLight } from '../../../hooks/useTheme';
import { normalizeThemeMode } from '../../../stores/settings/settingsOptions';
import { useSettingsStore, type ThemeMode } from '../../../stores/settingsStore';

export type PhoneColorScheme = 'light' | 'dark';

export interface PhoneColorSchemeInput {
  theme: ThemeMode;
  resolveThemeUnlocked: boolean;
  customBrightness: number;
  systemPrefersDark: boolean;
}

export function resolvePhoneColorScheme({ theme, resolveThemeUnlocked, customBrightness, systemPrefersDark }: PhoneColorSchemeInput): PhoneColorScheme {
  const active = normalizeThemeMode(theme, resolveThemeUnlocked);
  if (active === 'light') return 'light';
  if (active === 'system') return systemPrefersDark ? 'dark' : 'light';
  if (active === 'custom') return isCustomThemeLight(customBrightness) ? 'light' : 'dark';
  return 'dark';
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeSystemScheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DARK_QUERY).matches;
}

/** The phone palette for the current editor theme; follows the device while the theme is System. */
export function usePhoneColorScheme(): PhoneColorScheme {
  const theme = useSettingsStore((s) => s.theme);
  const resolveThemeUnlocked = useSettingsStore((s) => s.resolveThemeUnlocked);
  const customBrightness = useSettingsStore((s) => s.customBrightness);
  const systemPrefersDark = useSyncExternalStore(subscribeSystemScheme, readSystemPrefersDark, () => true);
  return resolvePhoneColorScheme({ theme, resolveThemeUnlocked, customBrightness, systemPrefersDark });
}
