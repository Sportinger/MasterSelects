/** Rom1 values its graph clamps or turns off (keyframes, curves and tools can set any value). */
type Params = Record<string, number | boolean | string>;

export function rom1ParamWarnings(params: Params): string[] {
  const notes: string[] = [];
  const value = (id: string) => typeof params[id] === 'number' && Number.isFinite(params[id]) ? params[id] as number : undefined;
  const gain = value('gain'), opacity = value('opacity');
  if (gain !== undefined && gain > 1) notes.push(`gain: ${gain} lifts every pixel past white; the trails fill the frame with white.`);
  if (gain !== undefined && gain < 0) notes.push(`gain: ${gain} is below 0; it renders as 0.`);
  if (opacity !== undefined && (opacity < 0 || opacity > 1)) notes.push(`opacity: ${opacity} is outside 0-1; it is clamped to ${opacity < 0 ? 0 : 1}.`);
  for (const id of ['speed', 'detail', 'density']) {
    const number = value(id);
    if (number !== undefined && number <= 0) notes.push(`${id}: ${number} is not above 0; it renders as 0.001 and the smoke stops ${id === 'speed' ? 'drifting' : 'swirling'}.`);
  }
  return notes;
}
