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

/** Starting points for the scan, each a complete set of the Look keys. */
export const SLIT_SCAN_LOOKS: readonly SlitScanLook[] = [
  look('sweep', 'Sweep · left → right', { profile: 'linear', angle: 0, delay: 1 }),
  look('fall', 'Falling time · top → bottom', { profile: 'linear', angle: 90, delay: 1.5 }),
  look('center', 'Out from the center', { profile: 'center', delay: 1.5 }),
  look('folds', 'Wave folds', { profile: 'wave', delay: 1.5, waves: 2, speed: 0.15 }),
  look('radial', 'Radial bloom', { profile: 'radial', delay: 1.5 }),
  look('rings', 'Time rings', { profile: 'rings', delay: 2, waves: 3, speed: 0.25 }),
  look('steps', 'Time steps · 12 bands', { profile: 'linear', angle: 0, delay: 2, bands: 12 }),
];

const same = (a: unknown, b: number | string) => typeof b === 'number' ? Math.abs(Number(a) - b) < 1e-6 : a === b;

/** The Look whose values the params carry, or 'custom' once any of them differs. */
export function slitScanLookOf(params: Record<string, unknown>): string {
  const value = (key: LookKey) => params[key] ?? slitScanParams[key].default;
  return SLIT_SCAN_LOOKS.find(item => SLIT_SCAN_LOOK_KEYS.every(key => same(value(key), item.params[key])))?.id ?? 'custom';
}

/** Params with a Look applied (unknown ids leave them unchanged). */
export function applySlitScanLook<T extends Record<string, unknown>>(params: T, id: string): T {
  const found = SLIT_SCAN_LOOKS.find(item => item.id === id);
  return found ? { ...params, ...found.params } : params;
}
