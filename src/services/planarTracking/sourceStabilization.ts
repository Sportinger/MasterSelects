import type { PlanarTrack, SurfaceQuad } from '../../types/planarTracking';
import { inverseMatrix, sampleSurface, validQuad } from './surfaceGeometry';

/** Serializable controls; the shared tracking asset remains the sole owner of samples. */
export interface SourceStabilizationSettings {
  referenceTime: number;
  strength: number;
  position: boolean;
  rotation: boolean;
  scale: boolean;
}

export type SourceStabilizationResult =
  | { valid: true; sourceToOutput: number[]; outputToSource: number[] }
  | { valid: false; reason: 'disabled-track' | 'reference-gap' | 'sample-gap' | 'invalid-geometry' };

/** Solve a similarity in pixel aspect, not distorted normalized UV coordinates.
 * This is an image-coordinate transform, not a second tracker or a perspective fit.
 * Evaluate separately at BOTH source PTS before interpolating temporal samples.
 */
export function sourceStabilization(
  track: PlanarTrack, sourceTime: number, settings: SourceStabilizationSettings,
  width: number, height: number,
): SourceStabilizationResult {
  if (!track.enabled) return { valid: false, reason: 'disabled-track' };
  const reference = sampleSurface(track, settings.referenceTime);
  if (!reference) return { valid: false, reason: 'reference-gap' };
  const sample = sampleSurface(track, sourceTime);
  if (!sample) return { valid: false, reason: 'sample-gap' };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || !Number.isFinite(settings.strength) || !validQuad(reference.quad) || !validQuad(sample.quad)
    || !Number.isFinite(reference.confidence) || reference.confidence <= 0
    || !Number.isFinite(sample.confidence) || sample.confidence <= 0) {
    return { valid: false, reason: 'invalid-geometry' };
  }
  const aspect = width / height;
  const center = (quad: SurfaceQuad) => quad.reduce((sum, point) =>
    ({ x: sum.x + point.x * aspect / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const a = center(sample.quad), b = center(reference.quad);
  let dot = 0, cross = 0, norm = 0;
  for (let i = 0; i < 4; i++) {
    const sx = sample.quad[i].x * aspect - a.x, sy = sample.quad[i].y - a.y;
    const rx = reference.quad[i].x * aspect - b.x, ry = reference.quad[i].y - b.y;
    dot += sx * rx + sy * ry; cross += sx * ry - sy * rx; norm += sx * sx + sy * sy;
  }
  const fittedScale = Math.hypot(dot, cross) / norm;
  if (!Number.isFinite(fittedScale) || fittedScale < 1e-6) return { valid: false, reason: 'invalid-geometry' };
  const strength = Math.max(0, Math.min(1, settings.strength));
  const angle = settings.rotation ? Math.atan2(cross, dot) * strength : 0;
  const scale = settings.scale ? Math.exp(Math.log(fittedScale) * strength) : 1;
  const c = Math.cos(angle) * scale, s = Math.sin(angle) * scale;
  const tx = settings.position ? a.x + (b.x - a.x) * strength : a.x;
  const ty = settings.position ? a.y + (b.y - a.y) * strength : a.y;
  // Rotate/scale around the current tracked center; position optionally moves it to reference.
  const matrix = [c, -s / aspect, (tx - c * a.x + s * a.y) / aspect,
    s * aspect, c, ty - s * a.x - c * a.y, 0, 0, 1];
  const inverse = inverseMatrix(matrix);
  return inverse ? { valid: true, sourceToOutput: matrix, outputToSource: inverse }
    : { valid: false, reason: 'invalid-geometry' };
}
