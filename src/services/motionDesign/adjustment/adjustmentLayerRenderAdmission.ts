import type { BlendMode } from '../../../types/blendMode';
import type { Layer } from '../../../types/layers';
import type { TimelineClip } from '../../../types/timeline';

/**
 * Layer-level render admission of an adjustment layer, shared by the layer builders (preview,
 * nested compositions, target previews, export), the inspector, the phone sheets, the export
 * notes and the AI tools. An adjustment layer has no picture of its own: it processes the
 * composite below it over the whole frame. What it supports renders (effects, effect graphs,
 * colour correction, masks, opacity, the five adjustment blend modes, node-graph layout and
 * parameter drivers); a property it cannot render is skipped alone and named, and the rest of
 * the layer still renders. Only a broken layer definition stops the layer.
 */
export type AdjustmentLayerPropertyCode =
  | 'transform'
  | 'opacity'
  | 'blend-mode'
  | '3d'
  | 'source-rect'
  | 'transition'
  | 'scene-graph'
  | 'custom-nodes';

export interface SkippedAdjustmentLayerProperty {
  readonly code: AdjustmentLayerPropertyCode;
  /** Plain sentence for the inspector, phone sheets, export notes, log and tool results. */
  readonly reason: string;
}

export const SUPPORTED_ADJUSTMENT_BLEND_MODES: ReadonlySet<BlendMode> = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
]);

const IDENTITY_EPSILON = 0.000001;

type AdjustmentLayerState = Pick<Layer, 'position' | 'scale' | 'rotation' | 'opacity' | 'blendMode'>
  & Partial<Pick<Layer, 'is3D' | 'sourceRect' | 'transitionRender' | 'sceneGraph' | 'sharedSceneGraph'
    | 'sharedSceneTime' | 'sharedSceneTransform' | 'sceneGraphOutputSelection'>>;

type AdjustmentClip = Partial<Pick<TimelineClip, 'is3D' | 'sourceRect' | 'transitionRender' | 'nodeGraph' | 'sceneGraphOutput'>>;

/** Why this clip is no adjustment layer the renderer can draw at all; null when it is one. */
export function adjustmentLayerDefinitionProblem(clip: Pick<TimelineClip, 'source' | 'motion'>): string | null {
  const motion = clip.motion;
  if (
    clip.source?.type !== 'motion-adjustment'
    || motion?.version !== 1
    || motion.kind !== 'adjustment'
    || motion.shape !== undefined
    || motion.appearance !== undefined
    || motion.replicator !== undefined
    || motion.modifierStack !== undefined
    || motion.replicatorRecovery !== undefined
  ) {
    return 'Invalid motion adjustment layer definition';
  }
  return null;
}

function isIdentityNumber(value: number | undefined, identity: number): boolean {
  const resolved = value ?? identity;
  return Number.isFinite(resolved) && Math.abs(resolved - identity) <= IDENTITY_EPSILON;
}

function hasIdentityTransform(state: Pick<Layer, 'position' | 'scale' | 'rotation'>): boolean {
  const rotation = typeof state.rotation === 'number' ? { x: 0, y: 0, z: state.rotation } : state.rotation;
  return isIdentityNumber(state.position?.x, 0)
    && isIdentityNumber(state.position?.y, 0)
    && isIdentityNumber(state.position?.z, 0)
    && isIdentityNumber(state.scale?.x, 1)
    && isIdentityNumber(state.scale?.y, 1)
    && isIdentityNumber(state.scale?.z, 1)
    && isIdentityNumber(rotation?.x, 0)
    && isIdentityNumber(rotation?.y, 0)
    && isIdentityNumber(rotation?.z, 0);
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10} %`;
}

/** The opacity an adjustment layer renders with: finite and within 0..1. */
export function renderedAdjustmentOpacity(opacity: number): number {
  return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
}

/**
 * Every property of `clip` (with its evaluated layer `state`) that an adjustment layer leaves out of
 * its render, in a fixed order. Supported state (effects, colour correction, masks, node-graph
 * layout and parameter drivers) is never listed.
 */
export function skippedAdjustmentLayerProperties(clip: AdjustmentClip, state: AdjustmentLayerState): SkippedAdjustmentLayerProperty[] {
  const skipped: SkippedAdjustmentLayerProperty[] = [];
  if (!hasIdentityTransform(state)) {
    skipped.push({ code: 'transform', reason: 'Its position, scale or rotation is not neutral; an adjustment layer always covers the whole frame, so the transform is ignored.' });
  }
  const opacity = renderedAdjustmentOpacity(state.opacity);
  if (!Number.isFinite(state.opacity) || opacity !== state.opacity) {
    skipped.push({ code: 'opacity', reason: `Its opacity ${Number.isFinite(state.opacity) ? percent(state.opacity) : 'is not a number'}; it renders at ${percent(opacity)}.` });
  }
  if (!SUPPORTED_ADJUSTMENT_BLEND_MODES.has(state.blendMode)) {
    skipped.push({ code: 'blend-mode', reason: `The blend mode ${state.blendMode} is not available on adjustment layers (Normal, Multiply, Screen, Overlay, Add); it renders with Normal.` });
  }
  if (clip.is3D === true || state.is3D === true) {
    skipped.push({ code: '3d', reason: 'It is set to 3D; an adjustment layer works on the flat composite below, so it renders flat.' });
  }
  if (clip.sourceRect !== undefined || state.sourceRect !== undefined) {
    skipped.push({ code: 'source-rect', reason: 'It has a source crop rectangle; an adjustment layer has no source picture, so the crop is ignored (a mask limits where it works).' });
  }
  if (clip.transitionRender !== undefined || state.transitionRender !== undefined) {
    skipped.push({ code: 'transition', reason: 'A transition is set on it; a transition blends a clip\'s own picture, which an adjustment layer does not have, so it is ignored.' });
  }
  if (clip.nodeGraph?.scene !== undefined || clip.sceneGraphOutput !== undefined || state.sceneGraph !== undefined || state.sharedSceneGraph !== undefined) {
    skipped.push({ code: 'scene-graph', reason: 'Its node graph holds a 3D scene; that needs a 3D layer, so it is ignored.' });
  }
  const customNodes = (clip.nodeGraph?.customNodes ?? []).filter((node) => node.bypassed !== true);
  if (customNodes.length > 0) {
    skipped.push({
      code: 'custom-nodes',
      reason: `Its node graph has custom nodes (${customNodes.map((node) => node.label || node.id).join(', ')}) that process a clip's own picture; an adjustment layer has none, so they are ignored.`,
    });
  }
  return skipped;
}

/** Static check of an adjustment clip as stored (its transform at rest), for the inspector, sheets and tools. */
export function inspectAdjustmentLayerProperties(clip: AdjustmentClip & Pick<TimelineClip, 'transform'>): SkippedAdjustmentLayerProperty[] {
  const transform = clip.transform;
  return skippedAdjustmentLayerProperties(clip, {
    position: transform?.position ?? { x: 0, y: 0, z: 0 },
    scale: transform?.scale ?? { x: 1, y: 1 },
    rotation: transform?.rotation ?? { x: 0, y: 0, z: 0 },
    opacity: transform?.opacity ?? 1,
    blendMode: transform?.blendMode ?? 'normal',
  });
}

export interface AdjustmentLayerRenderAdmission<T extends AdjustmentLayerState> {
  /** The layer state the compositor gets: every skipped property reset to what an adjustment layer renders. */
  readonly layer: T;
  readonly skipped: readonly SkippedAdjustmentLayerProperty[];
}

/** Admits the evaluated layer `state` of an adjustment clip: skipped properties are reset, the rest is kept. */
export function admitAdjustmentLayerForRender<T extends AdjustmentLayerState>(clip: AdjustmentClip, state: T): AdjustmentLayerRenderAdmission<T> {
  const skipped = skippedAdjustmentLayerProperties(clip, state);
  if (skipped.length === 0) return { layer: state, skipped };
  const layer: T = { ...state };
  for (const { code } of skipped) {
    if (code === 'transform') {
      layer.position = { x: 0, y: 0, z: 0 };
      layer.scale = { x: 1, y: 1, z: 1 };
      layer.rotation = typeof state.rotation === 'number' ? 0 : { x: 0, y: 0, z: 0 };
    } else if (code === 'opacity') {
      layer.opacity = renderedAdjustmentOpacity(state.opacity);
    } else if (code === 'blend-mode') {
      layer.blendMode = 'normal';
    } else if (code === '3d') {
      delete layer.is3D;
    } else if (code === 'source-rect') {
      delete layer.sourceRect;
    } else if (code === 'transition') {
      delete layer.transitionRender;
    } else if (code === 'scene-graph') {
      delete layer.sceneGraph;
      delete layer.sharedSceneGraph;
      delete layer.sharedSceneTime;
      delete layer.sharedSceneTransform;
      delete layer.sceneGraphOutputSelection;
    }
  }
  return { layer, skipped };
}
