// Settings option catalog: pure option types, default constants, and clamp
// helpers for the settings store. No store access, no persistence — the
// persist config and store creator stay in src/stores/settingsStore.ts.

// Theme mode options
export type ThemeMode = 'dark' | 'light' | 'midnight' | 'system' | 'crazy' | 'custom';

// Transcription provider options
export type TranscriptionProvider = 'local' | 'openai' | 'assemblyai' | 'deepgram';

// Preview quality options (multiplier on base resolution)
export type PreviewQuality = 1 | 0.5 | 0.25;

// GPU power preference options
export type GPUPowerPreference = 'high-performance' | 'low-power';

export type AIProvider = 'openai' | 'lemonade';

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

export interface APIKeys {
  openai: string;
  anthropic: string; // Anthropic key for Claude chat models
  assemblyai: string;
  deepgram: string;
  piapi: string;  // PiAPI key for AI video generation (Kling, Luma, etc.)
  kieai: string;  // Kie.ai key for Kling 3.0 and Nano Banana 2
  evolink: string; // EvoLink key for Nano Banana 2 fallback image generation
  elevenlabs: string; // ElevenLabs key for AI audio generation
  youtube: string; // YouTube Data API v3 key (optional, Invidious works without)
  // Legacy Kling keys (deprecated, use piapi instead)
  klingAccessKey: string;
  klingSecretKey: string;
}

export type ApiKeyDefaultProvider = 'openai' | 'anthropic' | 'piapi' | 'kieai' | 'evolink' | 'elevenlabs';
export type ApiKeyDefaults = Record<ApiKeyDefaultProvider, boolean>;

export const DEFAULT_API_KEY_DEFAULTS: ApiKeyDefaults = {
  openai: false,
  anthropic: false,
  piapi: false,
  kieai: false,
  evolink: false,
  elevenlabs: false,
};

// Autosave interval options (in minutes)
export type AutosaveInterval = 1 | 2 | 5 | 10;

// Save mode: continuous saves on every change (debounced), interval saves on a timer
export type SaveMode = 'continuous' | 'interval';
