import type { Composition } from '../../stores/mediaStore/types';
import type { BlendMode } from '../../types/blendMode';
import type { Layer } from '../../types/layers';
import { Logger } from '../logger';

const log = Logger.create('TransitionCompositionBlend');

/**
 * Blend modes that can be applied once to the finished transition instead of
 * to each clip inside it. Their result depends only on the straightened layer
 * colour and on alpha × opacity, so a clip drawn 'normal' into the transition
 * composition and then blended with the mode over the lower tracks gives the
 * same pixels as the clip drawn with the mode directly: no jump at either edge
 * of the transition. For modes that are linear in the layer colour (multiply,
 * screen, add, overlay, …) the dissolve itself is exact as well; the others
 * are exact at both ends and smooth in between. The luma stencil and the
 * silhouettes read opacity separately and are exact at full clip opacity.
 * Dissolve and Dancing Dissolve dither by layer opacity and are not liftable.
 */
const LIFTABLE_BLEND_MODES = new Set<BlendMode>([
  'darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color',
  'add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix',
  'difference', 'classic-difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add',
]);

export type TransitionCompositionBlendFallback = 'mixed-blend-modes' | 'unsupported-blend-mode';

export interface TransitionCompositionBlendResolution {
  /** Blend mode of the transition composition layer over the lower tracks. */
  blendMode: BlendMode;
  /** Nested layers with the participants' own blend mode moved to the composition layer. */
  nestedLayers: Layer[];
  /** Set when the participants' blend modes could not be carried through the transition. */
  fallback?: TransitionCompositionBlendFallback;
  participantBlendModes: BlendMode[];
}

const reportedFallbacks = new Set<string>();

function isParticipantClipId(clipId: string | undefined, baseIds: readonly string[]): boolean {
  if (!clipId) return false;
  return baseIds.some((baseId) => clipId === baseId || clipId.startsWith(`${baseId}:`));
}

/** True when an evaluated layer id embeds the clip id (`nested-layer-<id>`, `<compId>-<id>`, panels `<id>:…`). */
function embedsClipId(layerId: string, baseId: string): boolean {
  for (let index = layerId.indexOf(baseId); index >= 0; index = layerId.indexOf(baseId, index + 1)) {
    const before = index === 0 ? '-' : layerId[index - 1];
    const after = layerId[index + baseId.length] ?? ':';
    if (before === '-' && after === ':') return true;
  }
  return false;
}

/**
 * The render paths name nested layers differently: the preview keeps a
 * runtime source id in sourceClipId, composition evaluation sets clipId and
 * export uses the clip id; every path embeds the clip id in the layer id.
 */
function isParticipantLayer(layer: Layer, baseIds: readonly string[]): boolean {
  const { clipId } = layer as Layer & { clipId?: string };
  return isParticipantClipId(clipId, baseIds) ||
    isParticipantClipId(layer.sourceClipId, baseIds) ||
    baseIds.some((baseId) => embedsClipId(layer.id, baseId));
}

function getParticipantBlendModes(composition: Composition, baseIds: readonly string[]): BlendMode[] {
  const modes = new Set<BlendMode>();
  for (const clip of composition.timelineData?.clips ?? []) {
    if (!isParticipantClipId(clip.id, baseIds)) continue;
    modes.add(clip.transform?.blendMode ?? 'normal');
  }
  return [...modes];
}

/** Rewrites participant layers that still use their own mode; recipe modes ('plus', …) stay. */
function normalizeParticipantLayers(
  nestedLayers: Layer[],
  baseIds: readonly string[],
  participantModes: ReadonlySet<BlendMode>,
): Layer[] {
  let changed = false;
  const layers = nestedLayers.map((layer) => {
    if (layer.blendMode === 'normal' || !participantModes.has(layer.blendMode)) return layer;
    if (!isParticipantLayer(layer, baseIds)) return layer;
    changed = true;
    return { ...layer, blendMode: 'normal' as const };
  });
  return changed ? layers : nestedLayers;
}

function reportFallback(
  transitionId: string,
  fallback: TransitionCompositionBlendFallback,
  participantBlendModes: readonly BlendMode[],
): void {
  const key = `${transitionId}:${fallback}:${participantBlendModes.join(',')}`;
  if (reportedFallbacks.has(key)) return;
  if (reportedFallbacks.size > 500) reportedFallbacks.clear();
  reportedFallbacks.add(key);
  log.warn(
    fallback === 'mixed-blend-modes'
      ? 'The clips of this transition use different blend modes; the transition is drawn in Normal mode and each blend mode returns after it'
      : 'This blend mode cannot be carried through a transition; the transition is drawn in Normal mode',
    { transitionId, participantBlendModes },
  );
}

/**
 * Inside a transition composition every clip is drawn over a transparent
 * background, where Screen, Add or Multiply have nothing to blend with
 * (Multiply turns black). The participants' shared blend mode therefore moves
 * to the composition layer, which blends the finished transition over the
 * lower tracks. Different or unsupported modes fall back to Normal for the
 * transition and say so in the log.
 */
export function resolveTransitionCompositionBlend(params: {
  transitionId: string;
  composition: Composition;
  nestedLayers: Layer[];
}): TransitionCompositionBlendResolution {
  const { transitionId, composition, nestedLayers } = params;
  const link = composition.transitionComp;
  if (link?.kind !== 'transition-comp') {
    return { blendMode: 'normal', nestedLayers, participantBlendModes: [] };
  }
  const baseIds = [link.linkedOutgoingClipId, link.linkedIncomingClipId].filter(Boolean);
  const participantBlendModes = getParticipantBlendModes(composition, baseIds);
  const nonNormalModes = new Set(participantBlendModes.filter((mode) => mode !== 'normal'));
  if (nonNormalModes.size === 0) {
    return { blendMode: 'normal', nestedLayers, participantBlendModes };
  }

  const normalizedLayers = normalizeParticipantLayers(nestedLayers, baseIds, nonNormalModes);
  const sharedMode = participantBlendModes.length === 1 ? participantBlendModes[0] : undefined;
  if (sharedMode && LIFTABLE_BLEND_MODES.has(sharedMode)) {
    return { blendMode: sharedMode, nestedLayers: normalizedLayers, participantBlendModes };
  }

  const fallback: TransitionCompositionBlendFallback = sharedMode ? 'unsupported-blend-mode' : 'mixed-blend-modes';
  reportFallback(transitionId, fallback, participantBlendModes);
  return { blendMode: 'normal', nestedLayers: normalizedLayers, fallback, participantBlendModes };
}
