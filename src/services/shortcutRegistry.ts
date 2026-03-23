// Keyboard Shortcut Registry — central singleton for key matching
// Subscribes to settingsStore for reactive preset/override changes

import { useSettingsStore } from '../stores/settingsStore';
import { PRESETS, DEFAULT_PRESET_ID } from './shortcutPresets';
import type {
  ShortcutActionId,
  ShortcutMap,
  KeyCombo,
  ShortcutPresetId,
} from './shortcutTypes';

// ─── Key Matching ────────────────────────────────────────────────────

const isMac = navigator.platform.toUpperCase().includes('MAC');

function matchesCombo(combo: KeyCombo, e: KeyboardEvent): boolean {
  // Modifier matching: ctrl flag means Ctrl OR Meta (for Mac Cmd)
  const wantCtrl = !!combo.ctrl;
  const hasCtrl = e.ctrlKey || e.metaKey;
  if (wantCtrl !== hasCtrl) return false;

  const wantShift = !!combo.shift;
  if (wantShift !== e.shiftKey) return false;

  const wantAlt = !!combo.alt;
  if (wantAlt !== e.altKey) return false;

  // Code match takes priority (physical key)
  if (combo.code) {
    return e.code === combo.code;
  }

  // Key match (logical key, case-insensitive)
  if (combo.key) {
    return e.key.toLowerCase() === combo.key.toLowerCase();
  }

  return false;
}

// ─── Display Label ───────────────────────────────────────────────────

function formatKeyName(name: string): string {
  const map: Record<string, string> = {
    arrowleft: '\u2190',
    arrowright: '\u2192',
    arrowup: '\u2191',
    arrowdown: '\u2193',
    space: 'Space',
    delete: 'Del',
    backspace: 'Backspace',
    escape: 'Esc',
    numpadadd: '+',
    numpadsubtract: '-',
  };
  const lower = name.toLowerCase();
  if (map[lower]) return map[lower];
  // Capitalize single letter
  if (lower.length === 1) return lower.toUpperCase();
  // Capitalize first letter of others
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function comboToLabel(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push(isMac ? '\u2318' : 'Ctrl');
  if (combo.alt) parts.push(isMac ? '\u2325' : 'Alt');
  if (combo.shift) parts.push(isMac ? '\u21E7' : 'Shift');
  parts.push(formatKeyName(combo.key || combo.code || ''));
  return parts.join(isMac ? '' : '+');
}

// ─── Registry Class ──────────────────────────────────────────────────

class ShortcutRegistry {
  private effectiveMap: ShortcutMap;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.effectiveMap = this.computeMap();
    this.subscribe();
  }

  private computeMap(): ShortcutMap {
    const state = useSettingsStore.getState();
    const presetId: ShortcutPresetId = state.activeShortcutPreset || DEFAULT_PRESET_ID;
    const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET_ID];
    const overrides = state.shortcutOverrides;

    if (overrides) {
      return { ...preset.map, ...overrides } as ShortcutMap;
    }
    return { ...preset.map };
  }

  private subscribe(): void {
    // React to settingsStore changes
    this.unsubscribe = useSettingsStore.subscribe(
      (state) => ({
        preset: state.activeShortcutPreset,
        overrides: state.shortcutOverrides,
      }),
      () => {
        this.effectiveMap = this.computeMap();
      },
      { equalityFn: (a, b) => a.preset === b.preset && a.overrides === b.overrides },
    );
  }

  /** Check if a KeyboardEvent matches any combo for the given action */
  matches(action: ShortcutActionId, e: KeyboardEvent): boolean {
    const combos = this.effectiveMap[action];
    if (!combos) return false;
    return combos.some((combo) => matchesCombo(combo, e));
  }

  /** Get display label for first combo of an action, e.g. "Ctrl+S" */
  getLabel(action: ShortcutActionId): string {
    const combos = this.effectiveMap[action];
    if (!combos || combos.length === 0) return '';
    return comboToLabel(combos[0]);
  }

  /** Get display labels for all combos of an action */
  getLabels(action: ShortcutActionId): string[] {
    const combos = this.effectiveMap[action];
    if (!combos) return [];
    return combos.map(comboToLabel);
  }

  /** Get the current effective map */
  getMap(): ShortcutMap {
    return this.effectiveMap;
  }

  /** Get combos for a specific action */
  getCombos(action: ShortcutActionId): KeyCombo[] {
    return this.effectiveMap[action] || [];
  }

  /** Find which actions conflict with a proposed combo (excluding the given action) */
  findConflicts(
    excludeAction: ShortcutActionId,
    combo: KeyCombo,
  ): ShortcutActionId[] {
    const conflicts: ShortcutActionId[] = [];
    for (const [actionId, combos] of Object.entries(this.effectiveMap)) {
      if (actionId === excludeAction) continue;
      // Create a synthetic KeyboardEvent-like object for matching
      const syntheticEvent = {
        key: combo.key || '',
        code: combo.code || '',
        ctrlKey: !!combo.ctrl,
        metaKey: !!combo.ctrl, // ctrl flag covers both
        shiftKey: !!combo.shift,
        altKey: !!combo.alt,
      } as KeyboardEvent;

      if (combos.some((c) => matchesCombo(c, syntheticEvent))) {
        conflicts.push(actionId as ShortcutActionId);
      }
    }
    return conflicts;
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

// ─── HMR Singleton ───────────────────────────────────────────────────

let instance: ShortcutRegistry | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.shortcutRegistry) {
    instance = import.meta.hot.data.shortcutRegistry;
  }
  import.meta.hot.dispose((data) => {
    data.shortcutRegistry = instance;
  });
}

export function getShortcutRegistry(): ShortcutRegistry {
  if (!instance) {
    instance = new ShortcutRegistry();
  }
  return instance;
}

// Re-export for convenience
export { comboToLabel, matchesCombo };
