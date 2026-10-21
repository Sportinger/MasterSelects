import type { Composition } from '../../stores/mediaStore/types';
import type { BlendMode } from '../../types/blendMode';
import type { Layer } from '../../types/layers';
import type { SerializableClip } from '../../types/timeline';
import { isTransitionRecipeBlendWindowActive } from '../timeline/transitionRecipeBlendWindows';
import { Logger } from '../logger';

const log = Logger.create('TransitionCompositionBlend');

/**
 * Blend modes that can be applied once to a finished part of the transition
 * instead of to each layer inside it. Their result depends only on the
 * straightened layer colour and on alpha × opacity, so a layer drawn 'normal'
 * into the part and the part then blended with the mode over the lower tracks
 * gives the same pixels as the layer drawn with the mode directly: no jump at
 * either edge of the transition. For modes that are linear in the layer
 * colour (multiply, screen, add, overlay, …) a dissolve inside the part is
 * exact as well; the others are exact at both ends and smooth in between. The
 * luma stencil and the silhouettes read opacity separately and are exact at
 * full clip opacity. Dissolve and Dancing Dissolve dither by layer opacity and
 * are not liftable.
 */
const LIFTABLE_BLEND_MODES = new Set<BlendMode>([
  'darken', 'multiply', 'color-burn', 'classic-color-burn', 'linear-burn', 'darker-color',
  'add', 'lighten', 'screen', 'color-dodge', 'classic-color-dodge', 'linear-dodge', 'lighter-color',
  'overlay', 'soft-light', 'hard-light', 'linear-light', 'vivid-light', 'pin-light', 'hard-mix',
  'difference', 'classic-difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
  'stencil-alpha', 'stencil-luma', 'silhouette-alpha', 'silhouette-luma', 'alpha-add',
]);

export type TransitionCompositionBlendFallback = 'mixed-blend-modes' | 'unsupported-blend-mode' | 'participants-not-found';

/** One pass of the transition composition over the lower tracks. */
export interface TransitionCompositionBlendPart {
  /** Blend mode of this part over the lower tracks. */
  blendMode: BlendMode;
  /** The part's nested layers, top first. */
  nestedLayers: Layer[];
}

export interface TransitionCompositionBlendResolution {
  /**
   * Parts top first. One part unless the clips use blend modes: then the
   * clips and the transition's own solids and overlays are drawn as separate
   * parts, each in its own mode.
   */
  parts: TransitionCompositionBlendPart[];
  /** Set when the transition cannot carry the clips' blend modes exactly. */
  fallback?: TransitionCompositionBlendFallback;
  participantBlendModes: BlendMode[];
}

type ParticipantRole = 'outgoing' | 'incoming';

const reportedFallbacks = new Set<string>();

function isParticipantClipId(clipId: string | undefined, baseId: string): boolean {
  return !!clipId && (clipId === baseId || clipId.startsWith(`${baseId}:`));
}

/** True when an evaluated layer id embeds the clip id (`nested-layer-<id>`, `nested-export-<id>`, `<compId>-<id>`, panels `<id>:…`). */
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
function layerBelongsToClip(layer: Layer, clipId: string): boolean {
  const { clipId: layerClipId } = layer as Layer & { clipId?: string };
  return isParticipantClipId(layerClipId, clipId) ||
    isParticipantClipId(layer.sourceClipId, clipId) ||
    embedsClipId(layer.id, clipId);
}

interface ParticipantInfo {
  role: ParticipantRole;
  baseId: string;
  mode: BlendMode;
  clips: SerializableClip[];
}

function getParticipants(composition: Composition, baseIds: Record<ParticipantRole, string>): ParticipantInfo[] {
  const clips = composition.timelineData?.clips ?? [];
  return (['outgoing', 'incoming'] as const).map((role) => {
    const baseId = baseIds[role];
    const roleClips = baseId ? clips.filter((clip) => isParticipantClipId(clip.id, baseId)) : [];
    const baseClip = roleClips.find((clip) => clip.id === baseId) ?? roleClips[0];
    return { role, baseId, mode: baseClip?.transform?.blendMode ?? 'normal', clips: roleClips };
  });
}

function findParticipant(layer: Layer, participants: readonly ParticipantInfo[]): ParticipantInfo | undefined {
  return participants.find((participant) => participant.baseId && layerBelongsToClip(layer, participant.baseId));
}

/** The stored clip a participant layer was evaluated from (the longest matching id wins for panels). */
function findStoredClip(layer: Layer, participant: ParticipantInfo): SerializableClip | undefined {
  return participant.clips
    .filter((clip) => layerBelongsToClip(layer, clip.id))
    .toSorted((a, b) => b.id.length - a.id.length)[0];
}

/**
 * A participant layer still drawn in its clip's own mode is drawn Normal
 * inside its part; that mode blends the part instead. A recipe mode (the
 * Crossfade's 'plus', Additive Dissolve's 'add', …) stays, also when it
 * happens to equal the clip's own mode.
 */
function normalizeParticipantLayer(
  layer: Layer,
  participant: ParticipantInfo,
  compositionTime: number,
): Layer {
  if (participant.mode === 'normal' || layer.blendMode !== participant.mode) return layer;
  const stored = findStoredClip(layer, participant);
  if (isTransitionRecipeBlendWindowActive(stored?.transitionRecipeBlendWindows, compositionTime)) return layer;
  return { ...layer, blendMode: 'normal' };
}

function reportOnce(key: string, report: () => void): void {
  if (reportedFallbacks.has(key)) return;
  if (reportedFallbacks.size > 500) reportedFallbacks.clear();
  reportedFallbacks.add(key);
  report();
}

function reportFallback(
  transitionId: string,
  fallback: TransitionCompositionBlendFallback,
  participantBlendModes: readonly BlendMode[],
): void {
  reportOnce(`${transitionId}:${fallback}:${participantBlendModes.join(',')}`, () => logFallback(
    transitionId, fallback, participantBlendModes,
  ));
}

function logFallback(
  transitionId: string,
  fallback: TransitionCompositionBlendFallback,
  participantBlendModes: readonly BlendMode[],
): void {
  if (fallback === 'participants-not-found') {
    log.warn(
      'The clips of this transition were not found among its layers; their blend mode is drawn inside the transition, over a transparent background',
      { transitionId, participantBlendModes },
    );
    return;
  }
  if (fallback === 'mixed-blend-modes') {
    log.info(
      'The clips of this transition use different blend modes; each clip keeps its own mode, so the middle of the dissolve shows a little of the lower tracks',
      { transitionId, participantBlendModes },
    );
    return;
  }
  log.warn(
    'This blend mode cannot be carried through a transition; the clip is drawn in Normal mode during the transition',
    { transitionId, participantBlendModes },
  );
}

interface PartDraft extends TransitionCompositionBlendPart {
  key: string;
}

const isVisibleLayer = (layer: Layer) => layer.visible !== false && layer.opacity > 0;

/**
 * The Crossfade's 'plus' belongs on the upper of its two clips: the lower one
 * is drawn over the transparent background, the upper one added to it. When
 * the incoming track was moved below the outgoing one inside the composition,
 * the operator moves with it; left on the lower clip, the Normal clip above
 * would cover the sum, (1−t)·A + t²·B: a visible dip.
 */
function placePlusOnUpperParticipant(
  transitionId: string,
  nestedLayers: Layer[],
  participants: readonly ParticipantInfo[],
): Layer[] {
  const roles = nestedLayers.map((layer) => findParticipant(layer, participants)?.role);
  const plusIndex = nestedLayers.findIndex((layer, index) => roles[index] && layer.blendMode === 'plus');
  if (plusIndex < 0) return nestedLayers;
  const plusRole = roles[plusIndex];
  const upperIndex = roles.findIndex((role) => role && role !== plusRole);
  if (upperIndex < 0 || upperIndex > plusIndex) return nestedLayers;
  const upperRole = roles[upperIndex];
  reportOnce(`${transitionId}:plus-moved`, () => log.info(
    'The incoming clip is below the outgoing clip inside this transition; the dissolve adds the upper clip instead',
    { transitionId },
  ));
  return nestedLayers.map((layer, index) => {
    if (roles[index] === plusRole && layer.blendMode === 'plus') return { ...layer, blendMode: 'normal' as const };
    if (roles[index] === upperRole && index < plusIndex) return { ...layer, blendMode: 'plus' as const };
    return layer;
  });
}

/**
 * The Crossfade's 'plus' adds the incoming clip to everything below it in its
 * part. Clips the user put below the transition's own clips inside the
 * composition would be added too and overexpose the picture; they become their
 * own part underneath, so the dissolve is composited over them exactly.
 */
function splitBelowPlusParticipants(
  transitionId: string,
  nestedLayers: Layer[],
  participants: readonly ParticipantInfo[],
): TransitionCompositionBlendPart[] | null {
  let plusIndex = -1;
  let lowestParticipantIndex = -1;
  nestedLayers.forEach((layer, index) => {
    if (!findParticipant(layer, participants)) return;
    lowestParticipantIndex = index;
    if (plusIndex < 0 && layer.blendMode === 'plus') plusIndex = index;
  });
  if (plusIndex < 0) return null;
  const below = nestedLayers.slice(lowestParticipantIndex + 1);
  if (!below.some(isVisibleLayer)) return null;
  const between = nestedLayers.slice(plusIndex + 1, lowestParticipantIndex)
    .filter((layer) => !findParticipant(layer, participants) && isVisibleLayer(layer));
  if (between.length > 0) {
    reportOnce(`${transitionId}:plus-between`, () => log.warn(
      'A layer between the clips of this transition is added to the dissolve and brightens it; move it above or below both clips',
      { transitionId, layerIds: between.map((layer) => layer.id) },
    ));
  }
  return [
    { blendMode: 'normal', nestedLayers: nestedLayers.slice(0, lowestParticipantIndex + 1) },
    { blendMode: 'normal', nestedLayers: below },
  ];
}

/**
 * Inside a transition composition every clip is drawn over a transparent
 * background, where Screen, Add or Multiply have nothing to blend with
 * (Multiply turns black). The clips' blend mode therefore moves out of the
 * composition and blends a part of it over the lower tracks:
 * - both clips Normal: one part, as authored;
 * - both clips share a mode: the clips dissolve inside one part blended with
 *   that mode; the transition's own solids and overlays (Dip, Light Leak, …)
 *   are separate parts in their own mode, so a dip stays black and a light
 *   streak still screens;
 * - different modes: the outgoing and the incoming clip are separate parts,
 *   each in its own mode, so both edges match the clips exactly; only the
 *   middle of the dissolve differs a little from a single-mode dissolve.
 * Modes that cannot be lifted fall back to Normal and say so in the log.
 */
export function resolveTransitionCompositionBlend(params: {
  transitionId: string;
  composition: Composition;
  nestedLayers: Layer[];
  compositionTime?: number;
}): TransitionCompositionBlendResolution {
  const { transitionId, composition, compositionTime = Number.NaN } = params;
  const link = composition.transitionComp;
  if (link?.kind !== 'transition-comp') {
    return { parts: [{ blendMode: 'normal', nestedLayers: params.nestedLayers }], participantBlendModes: [] };
  }
  const participants = getParticipants(composition, {
    outgoing: link.linkedOutgoingClipId,
    incoming: link.linkedIncomingClipId,
  });
  const nestedLayers = placePlusOnUpperParticipant(transitionId, params.nestedLayers, participants);
  const participantBlendModes = [...new Set(participants.filter((participant) => participant.clips.length > 0)
    .map((participant) => participant.mode))];
  if (participants.every((participant) => participant.mode === 'normal')) {
    const parts = splitBelowPlusParticipants(transitionId, nestedLayers, participants) ??
      [{ blendMode: 'normal' as const, nestedLayers }];
    return { parts, participantBlendModes };
  }
  if (nestedLayers.length > 0 && !nestedLayers.some((layer) => findParticipant(layer, participants))) {
    reportFallback(transitionId, 'participants-not-found', participantBlendModes);
    return { parts: [{ blendMode: 'normal', nestedLayers }], participantBlendModes, fallback: 'participants-not-found' };
  }

  const outerMode = (participant: ParticipantInfo): BlendMode =>
    LIFTABLE_BLEND_MODES.has(participant.mode) ? participant.mode : 'normal';
  const sharedMode = participants[0].mode === participants[1].mode;
  const fallback: TransitionCompositionBlendFallback | undefined =
    participants.some((participant) => participant.mode !== 'normal' && !LIFTABLE_BLEND_MODES.has(participant.mode))
      ? 'unsupported-blend-mode'
      : sharedMode ? undefined : 'mixed-blend-modes';
  if (fallback) reportFallback(transitionId, fallback, participantBlendModes);

  const drafts: PartDraft[] = [];
  nestedLayers.forEach((layer, index) => {
    const participant = findParticipant(layer, participants);
    let key: string;
    let blendMode: BlendMode;
    let partLayer = layer;
    if (participant) {
      key = sharedMode ? 'participants' : participant.role;
      blendMode = outerMode(participant);
      partLayer = normalizeParticipantLayer(layer, participant, compositionTime);
    } else if (layer.blendMode !== 'normal' && LIFTABLE_BLEND_MODES.has(layer.blendMode)) {
      // A solid or overlay with its own mode blends over everything below it.
      key = `overlay:${index}`;
      blendMode = layer.blendMode;
      partLayer = { ...layer, blendMode: 'normal' };
    } else {
      key = 'normal';
      blendMode = 'normal';
    }
    const last = drafts[drafts.length - 1];
    if (last && (last.key === key || (last.blendMode === 'normal' && blendMode === 'normal'))) {
      last.nestedLayers.push(partLayer);
    } else {
      drafts.push({ key, blendMode, nestedLayers: [partLayer] });
    }
  });
  if (drafts.length === 0) drafts.push({ key: 'empty', blendMode: 'normal', nestedLayers: [] });

  const split = drafts.length > 1;
  const parts = drafts.map(({ blendMode, nestedLayers: layers }) => {
    // Alone in its part, the Crossfade's 'plus' has nothing to add to: draw it Normal.
    const lowest = layers[layers.length - 1];
    if (split && lowest?.blendMode === 'plus') {
      return { blendMode, nestedLayers: [...layers.slice(0, -1), { ...lowest, blendMode: 'normal' as const }] };
    }
    return { blendMode, nestedLayers: layers };
  });
  return { parts, participantBlendModes, ...(fallback ? { fallback } : {}) };
}
