import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { ClipTransform } from '../../types/timelineCore';
import { getEffectiveScale } from '../../utils/transformScale';
import {
  facingX,
  figureMirror,
  mirroredAngle,
  SKELETON_JOINTS,
  skeletonFromParams,
  solveSkeleton,
  STICK_FIGURE_REFERENCE_HEIGHT,
  type SkeletonJoint,
  type SkeletonShapeDefinition,
} from './skeletonRig';

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

/** Inverse of `mapLayerPointToComposition`: composition position units to layer-centred pixels. */
export function mapCompositionPointToLayer(x: number, y: number, transform: ClipTransform,
  width: number, height: number): { x: number; y: number } {
  const aspect = width / height;
  const scale = getEffectiveScale(transform.scale);
  const theta = (transform.rotation?.z ?? 0) * Math.PI / 180;
  const rx = (x - transform.position.x) / 2, ry = (y - transform.position.y) / (2 * aspect);
  const px = rx * Math.cos(theta) - ry * Math.sin(theta);
  const py = rx * Math.sin(theta) + ry * Math.cos(theta);
  const u = px, v = py * aspect;
  return {
    x: ((scale.x ? u / scale.x : 0) + (transform.anchor?.x ?? 0)) * width,
    y: ((scale.y ? v / scale.y : 0) + (transform.anchor?.y ?? 0)) * height,
  };
}

/** Composition size used for figure placement (the open composition). */
export function stickFigureFrameSize(): { width: number; height: number } {
  const composition = useMediaStore.getState().getActiveComposition();
  return { width: composition?.width || 1920, height: composition?.height || 1080 };
}

const sampling = new Set<string>();

/**
 * Where a Stick Figure joint is at a timeline time, including the figure clip's keyframes, node
 * sources and transform (parenting too). Reads the open timeline; export locks edits, so the values
 * match the export snapshot.
 */
export function sampleStickFigureJoint(ref: string, joint: SkeletonJoint, timelineTime: number): StickFigureJointSample {
  return sampleStickFigurePose(ref, timelineTime).joints[joint];
}

/** Every joint of a figure at a timeline time, plus the effective rig values that produced it. */
export interface StickFigurePoseSample {
  joints: Record<SkeletonJoint, StickFigureJointSample>;
  skeleton: SkeletonShapeDefinition;
  /** Lowest figure point minus Ground Y, in figure pixels (positive = below the ground). */
  groundPenetration: number;
  /** Composition pixels per figure pixel along x and y (scale and frame size included). */
  pixelScale: { x: number; y: number };
}

export function sampleStickFigurePose(ref: string, timelineTime: number): StickFigurePoseSample {
  const target = parseStickFigureRef(ref);
  if (!target) throw new Error('Pick a stick figure to attach to.');
  if (sampling.has(target.clipId)) throw new Error('Attach to Joint cannot follow a figure that depends on its own output.');
  const state = useTimelineStore.getState();
  const clip = state.clips.find(item => item.id === target.clipId);
  if (!clip) throw new Error('The stick figure clip is not in this composition.');
  const { width, height } = stickFigureFrameSize();
  sampling.add(target.clipId);
  try {
    const localTime = Math.max(0, Math.min(clip.duration, timelineTime - clip.startTime));
    const effect = state.getInterpolatedEffects(clip.id, localTime)
      .find(item => item.id === target.effectId && item.type === STICK_FIGURE_EFFECT);
    if (!effect) throw new Error('The stick figure effect was removed.');
    const skeleton = skeletonFromParams(effect.params);
    const { joints, boneAngles } = solveSkeleton(skeleton);
    const facing = figureMirror(effect.params);
    const unit = height / STICK_FIGURE_REFERENCE_HEIGHT;
    const transform = state.getInterpolatedTransform(clip.id, localTime);
    const samples = {} as Record<SkeletonJoint, StickFigureJointSample>;
    let lowest = -Infinity;
    for (const joint of SKELETON_JOINTS) {
      const point = mapLayerPointToComposition(facingX(joints[joint].x, skeleton.rootX, facing) * unit, joints[joint].y * unit,
        transform, width, height);
      const screenAngle = mirroredAngle(boneAngles[joint], facing);
      // Screen angles turn clockwise (y down); clip rotation turns the other way.
      samples[joint] = { ...point, rotation: (transform.rotation?.z ?? 0) - screenAngle };
      lowest = Math.max(lowest, joints[joint].y + (joint === 'head' ? skeleton.headRadius : skeleton.thickness / 2));
    }
    const scale = getEffectiveScale(transform.scale);
    return { joints: samples, skeleton, groundPenetration: lowest - skeleton.groundY,
      pixelScale: { x: Math.abs(scale.x) * unit, y: Math.abs(scale.y) * unit } };
  } finally {
    sampling.delete(target.clipId);
  }
}
