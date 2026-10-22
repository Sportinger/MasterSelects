import type { Effect } from '../../types/effects';
import type { Keyframe } from '../../types/keyframes';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { useTimelineStore } from '../../stores/timeline';
import {
  createDefaultSkeletonShape,
  figureMirror,
  unfacingX,
  SKELETON_ANGLE_KEYS,
  skeletonFromParams,
  solveSkeleton,
  solveSkeletonLimb,
  STICK_FIGURE_REFERENCE_HEIGHT,
  type SkeletonAngleKey,
  type SkeletonLimb,
} from './skeletonRig';
import {
  applySkeletonActions,
  parseSkeletonActions,
  SKELETON_ACTIONS,
  skeletonActionAimWeight,
  type SkeletonActionInstance,
} from './skeletonActions';
import {
  mapCompositionPointToLayer,
  sampleStickFigureJoint,
  STICK_FIGURE_EFFECT,
  stickFigureFrameSize,
} from './stickFigureJointRuntime';

type Params = Effect['params'];

const LIMB_PARAMS: Record<SkeletonLimb, readonly [SkeletonAngleKey, SkeletonAngleKey]> = {
  legL: ['hipL', 'kneeL'], legR: ['hipR', 'kneeR'], armL: ['shoulderL', 'elbowL'], armR: ['shoulderR', 'elbowR'],
};

const numberParam = (params: Params, key: string) => {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const DEFAULT_LEG = (() => { const shape = createDefaultSkeletonShape(); return shape.thigh + shape.shin; })();

/** The figure's leg length times Scale relative to the default figure: body-scaled actions travel and jump with it. */
export function stickFigureBodyScale(params: Params): number {
  const skeleton = skeletonFromParams(params);
  return (skeleton.thigh + skeleton.shin) / DEFAULT_LEG;
}

/**
 * The body scale each action travels and jumps with: the figure's size at the action's own start,
 * from the keyframes of Scale and the leg lengths. Without keys that is the current size; with keys a
 * finished walk keeps its distance when Scale changes later.
 */
function bodyScaleAtActionStart(effect: Effect, keyframes: readonly Keyframe[]): (instance: SkeletonActionInstance) => number {
  const keyed = BODY_KEYS.filter(key => keyframes.some(item => item.property === `effect.${effect.id}.${key}`));
  const current = stickFigureBodyScale(effect.params);
  if (!keyed.length) return () => current;
  const cache = new Map<number, number>();
  return instance => {
    let body = cache.get(instance.start);
    if (body === undefined) {
      const params: Params = { ...effect.params };
      for (const key of keyed) {
        const property = `effect.${effect.id}.${key}` as Keyframe['property'];
        params[key] = interpolateKeyframes([...keyframes], property, instance.start, numberParam(effect.params, key));
      }
      cache.set(instance.start, body = stickFigureBodyScale(params));
    }
    return body;
  };
}
const BODY_KEYS = ['scale', 'thigh', 'shin'] as const;

/** Limb angles that put the striking hand or foot on the target joint (or as close as it reaches). */
function aimLimb(clipId: string, timelineTime: number, clipTime: number, params: Params,
  instance: SkeletonActionInstance, limb: SkeletonLimb): Partial<Record<SkeletonAngleKey, number>> {
  // Aiming reads this clip's transform from the open timeline; nested copies keep the authored strike.
  if (!useTimelineStore.getState().clips.some(item => item.id === clipId)) throw new Error('Clip is not in the open timeline.');
  const target = sampleStickFigureJoint(instance.target!.figure, instance.target!.joint, timelineTime);
  const { width, height } = stickFigureFrameSize();
  const transform = useTimelineStore.getState().getInterpolatedTransform(clipId, clipTime);
  const local = mapCompositionPointToLayer(target.x, target.y, transform, width, height);
  const unit = height / STICK_FIGURE_REFERENCE_HEIGHT;
  const facing = figureMirror(params);
  const skeleton = skeletonFromParams(params);
  const { joints } = solveSkeleton(skeleton);
  const root = limb === 'legL' || limb === 'legR' ? joints.pelvis : joints.neck;
  const solved = solveSkeletonLimb(skeleton, limb, unfacingX(local.x / unit, skeleton.rootX, facing) - root.x, local.y / unit - root.y);
  const [upper, lower] = LIMB_PARAMS[limb];
  return { [upper]: solved.upper, [lower]: solved.lower };
}

/**
 * Stick Figure action lanes: after keyframes, before node sources. Actions blend into the joint
 * angles, add their travel to Pelvis X and their jump height to Lift; aimed actions bend the
 * striking limb toward their target around the contact. Effects without actions pass through.
 */
export function applyStickFigureActions(clip: { id?: string; startTime?: number } | undefined, effects: Effect[], clipTime: number,
  keyframes: readonly Keyframe[] = []): Effect[] {
  if (!effects.some(effect => effect.type === STICK_FIGURE_EFFECT && typeof effect.params.actions === 'string'
    && effect.params.actions.length > 2)) return effects;
  return effects.map(effect => {
    if (effect.type !== STICK_FIGURE_EFFECT || effect.enabled === false) return effect;
    const actions = parseSkeletonActions(effect.params.actions);
    if (!actions.length) return effect;
    const base = Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, numberParam(effect.params, key)])) as Record<SkeletonAngleKey, number>;
    const result = applySkeletonActions(base, numberParam(effect.params, 'lift'), actions, clipTime,
      bodyScaleAtActionStart(effect, keyframes));
    // Travel goes the way the figure faces; Pelvis X is a screen position.
    const facing = Math.sign(figureMirror(effect.params)) || 1;
    const params: Params = { ...effect.params, ...result.pose, lift: result.lift,
      rootX: numberParam(effect.params, 'rootX') + facing * result.advance };
    for (const instance of actions) {
      const weight = skeletonActionAimWeight(instance, clipTime);
      const limb = SKELETON_ACTIONS[instance.action].limb;
      if (weight <= 0 || !limb || !clip?.id || typeof clip.startTime !== 'number') continue;
      try {
        const aimed = aimLimb(clip.id, clip.startTime + clipTime, clipTime, params, instance, limb);
        for (const [key, value] of Object.entries(aimed)) {
          const current = numberParam(params, key);
          const delta = ((value - current + 540) % 360) - 180;
          params[key] = current + delta * weight;
        }
      } catch {
        // A missing or self-dependent target keeps the authored strike.
      }
    }
    return { ...effect, params };
  });
}
