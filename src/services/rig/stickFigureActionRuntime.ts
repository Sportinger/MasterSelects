import type { Effect } from '../../types/effects';
import { useTimelineStore } from '../../stores/timeline';
import {
  facingX,
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
  const facing = params.facing === 'left' ? -1 : 1;
  const skeleton = skeletonFromParams(params);
  const { joints } = solveSkeleton(skeleton);
  const root = limb === 'legL' || limb === 'legR' ? joints.pelvis : joints.neck;
  const solved = solveSkeletonLimb(skeleton, limb, facingX(local.x / unit, skeleton.rootX, facing) - root.x, local.y / unit - root.y);
  const [upper, lower] = LIMB_PARAMS[limb];
  return { [upper]: solved.upper, [lower]: solved.lower };
}

/**
 * Stick Figure action lanes: after keyframes, before node sources. Actions blend into the joint
 * angles, add their travel to Pelvis X and their jump height to Lift; aimed actions bend the
 * striking limb toward their target around the contact. Effects without actions pass through.
 */
export function applyStickFigureActions(clip: { id?: string; startTime?: number } | undefined, effects: Effect[], clipTime: number): Effect[] {
  if (!effects.some(effect => effect.type === STICK_FIGURE_EFFECT && typeof effect.params.actions === 'string'
    && effect.params.actions.length > 2)) return effects;
  return effects.map(effect => {
    if (effect.type !== STICK_FIGURE_EFFECT || effect.enabled === false) return effect;
    const actions = parseSkeletonActions(effect.params.actions);
    if (!actions.length) return effect;
    const base = Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, numberParam(effect.params, key)])) as Record<SkeletonAngleKey, number>;
    const result = applySkeletonActions(base, numberParam(effect.params, 'lift'), actions, clipTime);
    // Travel goes the way the figure faces; Pelvis X is a screen position.
    const facing = effect.params.facing === 'left' ? -1 : 1;
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
