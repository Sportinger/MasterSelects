/** Rom1 values its graph clamps or turns off (keyframes, curves and tools can set any value). */
type Params = Record<string, number | boolean | string>;

/** Share of the trail kept per frame: 0.98 was the fixed value before Trail existed (2026-10-22). */
export const ROM1_TRAIL_DEFAULT = 0.98;
/** At 1 a trail would never fade; the graph keeps it at or below this. */
export const ROM1_TRAIL_MAX = 0.995;

export function rom1ParamWarnings(params: Params): string[] {
  const notes: string[] = [];
  const value = (id: string) => typeof params[id] === 'number' && Number.isFinite(params[id]) ? params[id] as number : undefined;
  const gain = value('gain'), opacity = value('opacity');
  // Gain is added to every pixel through a knee: unchanged up to 0.25, then easing toward 0.5 (smokeGainUpgrade.ts).
  if (gain !== undefined && gain > 1) notes.push(`gain: ${gain} is above 1; above 0.25 the lift eases toward 0.5, so the frame washes out but never turns white.`);
  if (gain !== undefined && gain < 0) notes.push(`gain: ${gain} is below 0; it renders as 0.`);
  if (opacity !== undefined && (opacity < 0 || opacity > 1)) notes.push(`opacity: ${opacity} is outside 0-1; it is clamped to ${opacity < 0 ? 0 : 1}.`);
  const trail = value('trail');
  if (trail !== undefined && trail > ROM1_TRAIL_MAX) notes.push(`trail: ${trail} is above ${ROM1_TRAIL_MAX}; it renders as ${ROM1_TRAIL_MAX}, so the smoke still fades.`);
  if (trail !== undefined && trail < 0) notes.push(`trail: ${trail} is below 0; it renders as 0 (no trail).`);
  for (const id of ['speed', 'detail', 'density']) {
    const number = value(id);
    if (number !== undefined && number <= 0) notes.push(`${id}: ${number} is not above 0; it renders as 0.001 and the smoke stops ${id === 'speed' ? 'drifting' : 'swirling'}.`);
  }
  return notes;
}
