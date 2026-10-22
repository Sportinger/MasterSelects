import { slitScanParams } from './parameters';

/** The artistic Time and Wave values a Look sets; sampling, storage and the other sections stay as they are. */
export const SLIT_SCAN_LOOK_KEYS = ['profile', 'angle', 'delay', 'bands', 'mix', 'waves', 'phase', 'speed'] as const;
type LookKey = typeof SLIT_SCAN_LOOK_KEYS[number];

export interface SlitScanLook {
  readonly id: string;
  readonly label: string;
  readonly params: Readonly<Record<LookKey, number | string>>;
}

const look = (id: string, label: string, values: Partial<Record<LookKey, number | string>>): SlitScanLook => ({
  id, label, params: Object.fromEntries(SLIT_SCAN_LOOK_KEYS.map(key => [key, values[key] ?? slitScanParams[key].default])) as Record<LookKey, number | string>,
});

/**
 * The presets of the card's Preset row, each a complete set of the Look keys. They set only the Time and Wave
 * values, so storage, sampling, 3D geometry, time fields and protection stay as they are (the shared preset
 * row would return every other control to its default, src/services/effects/effectPresets.ts).
 * Falling time (Top → bottom) and Center out (Profile → Out from center) were retired as presets: each is
 * one row away from Sweep. Sweep reaches 3 s back, so a figure in the middle of a wide frame visibly folds;
 * the default Delay stays 1 s (a shorter frame window to load).
 */
export const SLIT_SCAN_LOOKS: readonly SlitScanLook[] = [
  look('sweep', 'Sweep', { profile: 'linear', angle: 0, delay: 3 }),
  look('folds', 'Wave Folds', { profile: 'wave', delay: 2, waves: 2, speed: 0.15 }),
  look('radial', 'Radial Bloom', { profile: 'radial', delay: 3 }),
  look('rings', 'Time Rings', { profile: 'rings', delay: 2, waves: 3, speed: 0.25 }),
  look('steps', 'Time Steps', { profile: 'linear', angle: 0, delay: 2, bands: 12 }),
];

const same = (a: unknown, b: number | string) => typeof b === 'number' ? Math.abs(Number(a) - b) < 1e-6 : a === b;

/** The Look whose values the params carry, or 'custom' once any of them differs or is animated (keyframes or
 * a node source decide that value at render time, not the static value a Look writes). */
export function slitScanLookOf(params: Record<string, unknown>, animatedKeys: readonly string[] = []): string {
  if (animatedKeys.some(key => (SLIT_SCAN_LOOK_KEYS as readonly string[]).includes(key))) return 'custom';
  const value = (key: LookKey) => params[key] ?? slitScanParams[key].default;
  return SLIT_SCAN_LOOKS.find(item => SLIT_SCAN_LOOK_KEYS.every(key => same(value(key), item.params[key])))?.id ?? 'custom';
}

/** Params with a Look applied (unknown ids leave them unchanged). */
export function applySlitScanLook<T extends Record<string, unknown>>(params: T, id: string): T {
  const found = SLIT_SCAN_LOOKS.find(item => item.id === id);
  return found ? { ...params, ...found.params } : params;
}
