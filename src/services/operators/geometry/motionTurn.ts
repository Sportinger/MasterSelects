/** Integrate a smooth direction change against an existing speed envelope.
 * Eight-point Gauss–Legendre is exact for each polynomial piece here (degree ≤15).
 * Split at speed-envelope boundaries; the result never depends on previous frames.
 */
export function motionTurnDistance(
  start: number, end: number, turnStart: number, turnDuration: number,
  duration: number, attack: number, release: number, stopPower: number, minimumSpeed = 0,
): number {
  const nodes = [0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
  const weights = [0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
  const boundaries = [start, attack, duration - release, end]
    .filter(t => t >= start && t <= end).toSorted((a, b) => a - b);
  const smooth = (u: number) => u * u * (3 - 2 * u);
  const integrand = (t: number) => {
    const speed = t < attack ? smooth(t / attack)
      : release > 0 && t > duration - release ? smooth((duration - t) / release) ** stopPower : 1;
    return (minimumSpeed + (1 - minimumSpeed) * speed) * smooth((t - turnStart) / turnDuration);
  };
  let sum = 0;
  for (let piece = 1; piece < boundaries.length; piece++) {
    const half = (boundaries[piece] - boundaries[piece - 1]) / 2;
    const mid = (boundaries[piece] + boundaries[piece - 1]) / 2;
    for (let i = 0; i < nodes.length; i++)
      sum += half * weights[i] * (integrand(mid - half * nodes[i]) + integrand(mid + half * nodes[i]));
  }
  return sum;
}
