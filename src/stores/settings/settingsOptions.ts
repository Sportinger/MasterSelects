// Settings option catalog: pure option types, default constants, and clamp
// helpers for the settings store. No store access, no persistence — the
// persist config and store creator stay in src/stores/settingsStore.ts.

// `resolve` is hidden by default. Older persisted selections normalize to
// dark unless the user has explicitly unlocked the theme.
export type ActiveThemeMode = 'dark' | 'light' | 'midnight' | 'system' | 'crazy' | 'custom';
export type ThemeMode = ActiveThemeMode | 'resolve';

const ACTIVE_THEME_MODES: readonly ActiveThemeMode[] = [
  'dark',
  'light',
  'midnight',
  'system',
  'crazy',
  'custom',
];

export function normalizeThemeMode(theme: unknown): ActiveThemeMode;
export function normalizeThemeMode(theme: unknown, allowResolve: boolean): ThemeMode;
export function normalizeThemeMode(theme: unknown, allowResolve = false): ThemeMode {
  if (theme === 'resolve') {
    return allowResolve ? 'resolve' : 'dark';
  }
  return ACTIVE_THEME_MODES.includes(theme as ActiveThemeMode)
    ? theme as ActiveThemeMode
    : 'dark';
}

// Transcription provider options
export type TranscriptionProvider = 'local' | 'openai' | 'deepgram' | 'hybrid';

// Preview quality options (multiplier on base resolution)
export type PreviewQuality = 1 | 0.5 | 0.25;

// GPU power preference options
export type GPUPowerPreference = 'high-performance' | 'low-power';

export type GuidedActionReplayVisualizationMode = 'off' | 'concise' | 'full';
export type GuidedActionReplayCompressionMode = 'none' | 'family' | 'aggressive';
export type TimelineZoomAnchor = 'playhead' | 'mouse';

export const DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS = 3000;
export const DEFAULT_SHORTCUT_DISPLAY_SCALE = 1;
export const MIN_SHORTCUT_DISPLAY_SCALE = 0.75;
export const MAX_SHORTCUT_DISPLAY_SCALE = 2;

export function clampGuidedActionReplayBudgetMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS;
  }
  return Math.max(0, Math.round(value));
}

export function clampShortcutDisplayScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SHORTCUT_DISPLAY_SCALE;
  }
  return Math.min(MAX_SHORTCUT_DISPLAY_SCALE, Math.max(MIN_SHORTCUT_DISPLAY_SCALE, value));
}

// Autosave interval options (in minutes)
export type AutosaveInterval = 1 | 2 | 5 | 10;

// Save mode: continuous saves on every change (debounced), interval saves on a timer
export type SaveMode = 'manual' | 'interval' | 'continuous'; // continuous is accepted only for legacy migration
