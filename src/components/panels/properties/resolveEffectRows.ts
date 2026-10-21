/**
 * Effects whose generic parameter rows use the shared Resolve inspector design (AGENTS.md
 * section 9) instead of the older generic rows. Add an effect here when its inspector is revised.
 */
export const RESOLVE_ROW_EFFECTS: ReadonlySet<string> = new Set(['gaussian-blur', 'box-blur', 'motion-blur', 'radial-blur', 'zoom-blur',
  'crt-screen', 'glitch', 'film-prism', 'holo', 'ribbon-scan', 'crystal', 'glass-dispersion', 'wave-lines', 'pixel-sort']);

/** Parameter types that have a Resolve row (ResolveEffectParamRow); others keep the generic control. */
export function hasResolveEffectParamRow(definition: { type: string }): boolean {
  return definition.type === 'number' || definition.type === 'select';
}
