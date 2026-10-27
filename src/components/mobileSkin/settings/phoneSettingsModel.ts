// Draft of the phone Settings sheet: the preferences Done writes to the shared settings store and
// Cancel throws away. Settings are not part of the project, so they never enter the undo history.
import { useSettingsStore } from '../../../stores/settingsStore';
import {
  clampGuidedActionReplayBudgetMs, clampShortcutDisplayScale, DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS, DEFAULT_SHORTCUT_DISPLAY_SCALE,
  type GuidedActionReplayCompressionMode, type GuidedActionReplayVisualizationMode, type ThemeMode, type TimelineZoomAnchor,
  type TranscriptionProvider,
} from '../../../stores/settings/settingsOptions';

export interface PhoneSettingsDraft {
  theme: ThemeMode;
  customHue: number;
  customBrightness: number;
  transcriptionProvider: TranscriptionProvider;
  deselectClipOnRepeatClick: boolean;
  timelineZoomAnchor: TimelineZoomAnchor;
  automaticMobileLayoutEnabled: boolean;
  /** Input display: the desktop's "Show shortcuts and mouse clicks"; on the phone it rings every touch. */
  showShortcutDisplay: boolean;
  shortcutDisplayScale: number;
  replayMode: GuidedActionReplayVisualizationMode;
  replayBudgetMs: number;
  replayCompression: GuidedActionReplayCompressionMode;
}

export const PHONE_REPLAY_MODES: ReadonlyArray<{ id: GuidedActionReplayVisualizationMode; label: string }> = [
  { id: 'concise', label: 'Short' },
  { id: 'full', label: 'Full' },
  { id: 'off', label: 'Off' },
];

export const PHONE_REPLAY_COMPRESSION: ReadonlyArray<{ id: GuidedActionReplayCompressionMode; label: string }> = [
  { id: 'family', label: 'Grouped' },
  { id: 'none', label: 'None' },
  { id: 'aggressive', label: 'Strong' },
];

export type PhoneBudgetUnit = 'ms' | 's' | 'min' | 'h';
export const PHONE_BUDGET_UNITS: ReadonlyArray<{ id: PhoneBudgetUnit; label: string; ms: number }> = [
  { id: 'ms', label: 'ms', ms: 1 },
  { id: 's', label: 's', ms: 1000 },
  { id: 'min', label: 'min', ms: 60_000 },
  { id: 'h', label: 'h', ms: 3_600_000 },
];

/** The largest unit that shows the budget as a whole number (3000 ms -> 3 s). */
export function phoneBudgetUnitFor(ms: number): PhoneBudgetUnit {
  const fitting = [...PHONE_BUDGET_UNITS].reverse().find((unit) => ms > 0 && ms % unit.ms === 0);
  return fitting?.id ?? 's';
}

/** Budget typed in `unit`; empty or invalid text keeps the previous budget. */
export function parsePhoneBudget(text: string, unit: PhoneBudgetUnit, previousMs: number): number {
  const value = Number.parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return previousMs;
  const factor = PHONE_BUDGET_UNITS.find((entry) => entry.id === unit)?.ms ?? 1;
  return clampGuidedActionReplayBudgetMs(value * factor);
}

export const PHONE_REPLAY_DEFAULTS = {
  replayMode: 'concise' as GuidedActionReplayVisualizationMode,
  replayBudgetMs: DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS,
  replayCompression: 'family' as GuidedActionReplayCompressionMode,
};

export const PHONE_INPUT_DISPLAY_DEFAULTS = { showShortcutDisplay: false, shortcutDisplayScale: DEFAULT_SHORTCUT_DISPLAY_SCALE };
export { clampShortcutDisplayScale };

export const PHONE_THEMES: ReadonlyArray<{ id: ThemeMode; label: string; swatch: string }> = [
  { id: 'dark', label: 'Dark', swatch: '#1e1e1e' },
  { id: 'light', label: 'Light', swatch: '#f5f5f5' },
  { id: 'midnight', label: 'Midnight', swatch: '#000000' },
  { id: 'system', label: 'System', swatch: 'linear-gradient(135deg, #1e1e1e 50%, #f5f5f5 50%)' },
  { id: 'crazy', label: 'Crazy You', swatch: 'linear-gradient(135deg, #e91e63, #2196f3 66%, #4caf50)' },
  { id: 'custom', label: 'Custom', swatch: 'linear-gradient(135deg, hsl(210,30%,12%), hsl(210,30%,22%))' },
];

export const PHONE_RESOLVE_THEME = { id: 'resolve' as ThemeMode, label: 'Resolve', swatch: '#202126' };

export const PHONE_TRANSCRIPTION_PROVIDERS: ReadonlyArray<{ id: TranscriptionProvider; label: string; hosted: boolean; description: string }> = [
  { id: 'local', label: 'On this device', hosted: false, description: 'Local Whisper. Private, no account, slower.' },
  { id: 'openai', label: 'OpenAI Whisper', hosted: true, description: 'Hosted, uses your credits.' },
  { id: 'deepgram', label: 'Deepgram', hosted: true, description: 'Hosted Nova-3, uses your credits.' },
  { id: 'hybrid', label: 'Best quality', hosted: true, description: 'Deepgram text plus OpenAI speakers, uses your credits.' },
];

export function readPhoneSettingsDraft(): PhoneSettingsDraft {
  const state = useSettingsStore.getState();
  return {
    theme: state.theme,
    customHue: state.customHue,
    customBrightness: state.customBrightness,
    transcriptionProvider: state.transcriptionProvider,
    deselectClipOnRepeatClick: state.deselectClipOnRepeatClick,
    timelineZoomAnchor: state.timelineZoomAnchor,
    automaticMobileLayoutEnabled: state.automaticMobileLayoutEnabled,
    showShortcutDisplay: state.showShortcutDisplay,
    shortcutDisplayScale: state.shortcutDisplayScale,
    replayMode: state.guidedActionReplayVisualizationMode,
    replayBudgetMs: state.guidedActionReplayBudgetMs,
    replayCompression: state.guidedActionReplayCompressionMode,
  };
}

/** Writes only the fields that changed; returns how many settings were written. */
export function applyPhoneSettingsDraft(draft: PhoneSettingsDraft): number {
  const before = readPhoneSettingsDraft();
  const state = useSettingsStore.getState();
  let written = 0;
  const write = <K extends keyof PhoneSettingsDraft>(key: K, setter: (value: PhoneSettingsDraft[K]) => void) => {
    if (before[key] === draft[key]) return;
    setter(draft[key]);
    written += 1;
  };
  write('theme', state.setTheme);
  write('customHue', state.setCustomHue);
  write('customBrightness', state.setCustomBrightness);
  write('transcriptionProvider', state.setTranscriptionProvider);
  write('deselectClipOnRepeatClick', state.setDeselectClipOnRepeatClick);
  write('timelineZoomAnchor', state.setTimelineZoomAnchor);
  write('automaticMobileLayoutEnabled', state.setAutomaticMobileLayoutEnabled);
  write('showShortcutDisplay', state.setShowShortcutDisplay);
  write('shortcutDisplayScale', (value) => state.setShortcutDisplayScale(clampShortcutDisplayScale(value)));
  write('replayMode', state.setGuidedActionReplayVisualizationMode);
  write('replayBudgetMs', state.setGuidedActionReplayBudgetMs);
  write('replayCompression', state.setGuidedActionReplayCompressionMode);
  return written;
}

/** Hosted providers need a signed-in (or guest) hosted session; otherwise local is used. */
export function phoneTranscriptionAvailability(provider: TranscriptionProvider, hostedSession: boolean): { ok: true } | { ok: false; reason: string } {
  const entry = PHONE_TRANSCRIPTION_PROVIDERS.find((candidate) => candidate.id === provider);
  if (!entry?.hosted || hostedSession) return { ok: true };
  return { ok: false, reason: 'Sign in under Account to use hosted transcription. On this device works without an account.' };
}
