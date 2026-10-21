/**
 * Effects whose generic parameter rows use the shared Resolve inspector design (AGENTS.md
 * section 9) instead of the older generic rows. Add an effect here when its inspector is revised.
 */
export const RESOLVE_ROW_EFFECTS: ReadonlySet<string> = new Set(['gaussian-blur', 'box-blur', 'motion-blur', 'radial-blur', 'zoom-blur',
  'wave', 'twirl', 'bulge', 'kaleidoscope', 'mirror', 'rgb-split', 'pixelate', 'blockify', 'block-mosaic']);

/** Parameter types that have a Resolve row (ResolveEffectParamRow); others keep the generic control. */
export function hasResolveEffectParamRow(definition: { type: string }): boolean {
  return definition.type === 'number' || definition.type === 'select' || definition.type === 'boolean' || definition.type === 'color';
}

/** Decimals a step implies (0.5 → 1, 0.05 → 2, 0.001 → 3), so values read like the slider moves. */
export function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  const fraction = /\.(\d+)$/.exec(String(Number(step.toPrecision(6))))?.[1];
  return Math.min(4, fraction ? fraction.length : step >= 1 ? 0 : Math.ceil(-Math.log10(step)));
}
