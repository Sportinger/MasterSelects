import { withLegacyMirrorPixelControls } from '../../services/operators/mirrorPixelGraphUpgrade';
import { withLegacyAcuarelaGraph } from '../../services/operators/acuarelaIdentity';
import { withLegacySheenParams } from '../stylize/sheen/legacy';

type Params = Record<string, number | boolean | string>;

/**
 * A custom Look stores parameters only. Values (or a graph) that keep the saved appearance of
 * effects that gained controls or a new recipe after the Look was saved; applied after the
 * defaults are filled in, so a Look looks the same as when it was saved.
 */
export function withLegacyLookParams(effectId: string, params: Params): Params {
  const controls = withLegacyMirrorPixelControls(effectId, params) as Params;
  const particles = effectId === 'pixel-particle-disintegrate'
    ? { ...controls, fade: controls.fade ?? 0, cellReference: controls.cellReference ?? 'output' } : controls;
  const sheen = effectId === 'sheen' ? withLegacySheenParams(particles)
    : effectId === 'voxel-relief' ? { ...particles, shading: particles.shading ?? 'legacy', distance: particles.distance ?? 1, framing: particles.framing ?? 'height' } : particles;
  return withLegacyAcuarelaGraph(effectId, sheen);
}
