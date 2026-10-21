/** Sheen values the shader turns off or clamps (keyframes, curves and tools can set any value). */
type Params = Record<string, number | boolean | string>;

export function sheenParamWarnings(params: Params): string[] {
  const notes: string[] = [];
  const intensity = params.intensity, width = params.width, softness = params.softness, highlights = params.highlights;
  if (typeof intensity === 'number' && intensity < 0) notes.push(`intensity: ${intensity} is below 0; it renders as 0 (no sheen). Use a darker Color for a dim sweep.`);
  if (typeof width === 'number' && width <= 0) notes.push(`width: ${width} has no band; it renders as the thinnest line.`);
  if (typeof softness === 'number' && (softness < 0 || softness > 1)) notes.push(`softness: ${softness} is outside 0-1; it is clamped to ${softness < 0 ? 0 : 1}.`);
  if (typeof highlights === 'number' && (highlights < 0 || highlights > 1)) notes.push(`highlights: ${highlights} is outside 0-1; it is clamped to ${highlights < 0 ? 0 : 1}.`);
  if (params.profile === 'plateau') notes.push('profile: this effect was saved with the flat-topped band; it keeps that look. Add Sheen again for light that falls off from the centre.');
  return notes;
}
