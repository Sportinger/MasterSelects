// Small pure checks of the Bake and Compare sheets.

/** Composition baking encodes with WebCodecs; without a VideoEncoder the button is greyed with the reason. */
export function hasPhoneVideoEncoder(): boolean {
  return typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'function';
}

/** Same rule as the editor's comparison dock: a set in review or building with at least one option. */
export function hasOpenPhoneVariantSet(sets: Readonly<Record<string, { status: string; optionIds: readonly string[] }>>): boolean {
  return Object.values(sets).some((set) => (set.status === 'review' || set.status === 'building') && set.optionIds.length > 0);
}
