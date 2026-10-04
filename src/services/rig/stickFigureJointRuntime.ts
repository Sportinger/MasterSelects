import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { ClipTransform } from '../../types/timelineCore';
import { getEffectiveScale } from '../../utils/transformScale';
import { skeletonFromParams, solveSkeleton, STICK_FIGURE_REFERENCE_HEIGHT, type SkeletonJoint } from './skeletonRig';

export const STICK_FIGURE_EFFECT = 'stick-figure';

/** A joint of a Stick Figure effect in composition terms: clip-transform position units and degrees. */
export interface StickFigureJointSample {
  /** Composition half-extents, ready to drive another clip's Position. */
  x: number; y: number;
  /** Direction of the bone ending at the joint as a clip Rotation value (degrees). */
  rotation: number;
}

/** A figure reference names the clip and the Stick Figure effect on it: `clipId|effectId`. */
export const stickFigureRef = (clipId: string, effectId: string) => `${clipId}|${effectId}`;
export function parseStickFigureRef(ref: string): { clipId: string; effectId: string } | null {
  const split = ref.indexOf('|');
  return split > 0 && split < ref.length - 1 ? { clipId: ref.slice(0, split), effectId: ref.slice(split + 1) } : null;
}

/** Stick Figure effects in the active timeline, for pickers. */
export function listStickFigures(): Array<{ ref: string; label: string }> {
  return useTimelineStore.getState().clips.flatMap(clip => clip.effects
    .filter(effect => effect.type === STICK_FIGURE_EFFECT)
    .map((effect, index, figures) => ({
      ref: stickFigureRef(clip.id, effect.id),
      label: figures.length > 1 ? `${clip.name} / ${effect.name} ${index + 1}` : clip.name,
    })));
}

/**
 * Map a point given in composition pixels relative to a layer's centre through that layer's 2D
 * clip transform, mirroring the compositor (anchor, scale, Z rotation, then position). Layers are
 * assumed to fill the frame, as Blank and Solid clips do; X/Y rotation and perspective are ignored.
 */
export function mapLayerPointToComposition(pointX: number, pointY: number, transform: ClipTransform,
  width: number, height: number): { x: number; y: number } {
  const aspect = width / height;
  const scale = getEffectiveScale(transform.scale);
  const u = (pointX / width - (transform.anchor?.x ?? 0)) * scale.x;
  const v = (pointY / height - (transform.anchor?.y ?? 0)) * scale.y;
  // The compositor rotates output coordinates by +θ to find the source, so content turns by -θ.
  const theta = (transform.rotation?.z ?? 0) * Math.PI / 180;
  const px = u, py = v / aspect;
  const rx = px * Math.cos(theta) + py * Math.sin(theta);
  const ry = -px * Math.sin(theta) + py * Math.cos(theta);
  return { x: 2 * rx + transform.position.x, y: 2 * ry * aspect + transform.position.y };
}

const sampling = new Set<string>();

/**
 * Where a Stick Figure joint is at a timeline time, including the figure clip's keyframes, node
 * sources and transform (parenting too). Reads the open timeline; export locks edits, so the values
 * match the export snapshot.
 */
export function sampleStickFigureJoint(ref: string, joint: SkeletonJoint, timelineTime: number): StickFigureJointSample {
  const target = parseStickFigureRef(ref);
  if (!target) throw new Error('Pick a stick figure to attach to.');
  if (sampling.has(target.clipId)) throw new Error('Attach to Joint cannot follow a figure that depends on its own output.');
  const state = useTimelineStore.getState();
  const clip = state.clips.find(item => item.id === target.clipId);
  if (!clip) throw new Error('The stick figure clip is not in this composition.');
  const composition = useMediaStore.getState().getActiveComposition();
  const width = composition?.width || 1920, height = composition?.height || 1080;
  sampling.add(target.clipId);
  try {
    const localTime = Math.max(0, Math.min(clip.duration, timelineTime - clip.startTime));
    const effect = state.getInterpolatedEffects(clip.id, localTime)
      .find(item => item.id === target.effectId && item.type === STICK_FIGURE_EFFECT);
    if (!effect) throw new Error('The stick figure effect was removed.');
    const { joints, boneAngles } = solveSkeleton(skeletonFromParams(effect.params));
    const facing = effect.params.facing === 'left' ? -1 : 1;
    const unit = height / STICK_FIGURE_REFERENCE_HEIGHT;
    const transform = state.getInterpolatedTransform(clip.id, localTime);
    const point = mapLayerPointToComposition(facing * joints[joint].x * unit, joints[joint].y * unit, transform, width, height);
    const screenAngle = facing > 0 ? boneAngles[joint] : 180 - boneAngles[joint];
    // Screen angles turn clockwise (y down); clip rotation turns the other way.
    return { ...point, rotation: (transform.rotation?.z ?? 0) - screenAngle };
  } finally {
    sampling.delete(target.clipId);
  }
}
