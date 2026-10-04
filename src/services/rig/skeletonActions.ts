import {
  gaitPose,
  getSkeletonPosePreset,
  SKELETON_ANGLE_KEYS,
  type SkeletonAngleKey,
  type SkeletonGait,
  type SkeletonJoint,
  type SkeletonLimb,
} from './skeletonRig';

/**
 * Action clips for Stick Figures: short authored motions (anticipation, contact, follow-through)
 * placed on a figure's action lane. They blend over the keyframed pose and under node sources.
 * Pure functions of time, so preview, scrubbing and export agree.
 */
export const SKELETON_ACTION_IDS = [
  'idle', 'walk', 'run', 'jump', 'punch', 'kick', 'duck', 'hit-react', 'throw', 'grab', 'land', 'fall',
] as const;
export type SkeletonActionId = typeof SKELETON_ACTION_IDS[number];

type Pose = Record<SkeletonAngleKey, number>;
type PoseRef = string | Partial<Pose> | readonly [string, Partial<Pose>];

interface ActionKey { at: number; pose: PoseRef; lift?: number }

export interface SkeletonActionDefinition {
  id: SkeletonActionId;
  label: string;
  /** Default duration in seconds; key times scale with an instance's duration. */
  duration: number;
  keys?: readonly ActionKey[];
  gait?: { gait: SkeletonGait; speed: number; stride: number };
  /** Moment of impact, release or landing, in seconds from the start (at the default duration). */
  contact?: number;
  /** Limb that strikes or reaches at the contact; it can be aimed at a target joint. */
  limb?: SkeletonLimb;
  /** Pixels the figure travels forward over the action; it stays there afterwards. */
  advance: number;
  /** Seconds to blend in and out of the surrounding pose. */
  blend: number;
  /** Keep the end pose after the action (until a later action blends over it), e.g. lying after a fall. */
  hold?: boolean;
}

const LIMB_JOINT: Record<SkeletonLimb, SkeletonJoint> = { armL: 'handL', armR: 'handR', legL: 'footL', legR: 'footR' };
export const limbJoint = (limb: SkeletonLimb) => LIMB_JOINT[limb];

// On the back: torso flat behind the pelvis, legs flat in front, one arm along the body and one
// flung over the head; every limb points slightly up so the body itself rests on the ground.
const LYING: Partial<Pose> = { spine: -90, head: 5, shoulderL: 10, elbowL: 10, shoulderR: 175, elbowR: 0, hipL: 92, kneeL: 2, hipR: 96, kneeR: 6 };

export const SKELETON_ACTIONS: Readonly<Record<SkeletonActionId, SkeletonActionDefinition>> = {
  idle: { id: 'idle', label: 'Idle', duration: 3, gait: { gait: 'idle', speed: 0.35, stride: 1 }, advance: 0, blend: 0.3 },
  walk: { id: 'walk', label: 'Walk', duration: 2, gait: { gait: 'walk', speed: 1, stride: 1 }, advance: 220, blend: 0.25 },
  run: { id: 'run', label: 'Run', duration: 1.5, gait: { gait: 'run', speed: 1.6, stride: 1 }, advance: 430, blend: 0.2 },
  jump: {
    id: 'jump', label: 'Jump', duration: 1.1, contact: 0.9, advance: 60, blend: 0.12,
    keys: [
      { at: 0, pose: 'stand' }, { at: 0.22, pose: 'crouch' }, { at: 0.34, pose: 'jump-air', lift: -60 },
      { at: 0.55, pose: 'jump-air', lift: -130 }, { at: 0.78, pose: ['jump-air', { kneeL: 40, kneeR: 30 }], lift: -55 },
      { at: 0.9, pose: 'crouch' }, { at: 1.1, pose: 'stand' },
    ],
  },
  punch: {
    id: 'punch', label: 'Punch', duration: 0.55, contact: 0.2, limb: 'armL', advance: 25, blend: 0.1,
    keys: [
      { at: 0, pose: 'ready' }, { at: 0.12, pose: ['ready', { shoulderL: 30, elbowL: 130, spine: 4 }] },
      { at: 0.2, pose: 'punch' }, { at: 0.32, pose: 'punch' }, { at: 0.55, pose: 'ready' },
    ],
  },
  kick: {
    id: 'kick', label: 'Kick', duration: 0.7, contact: 0.27, limb: 'legL', advance: 15, blend: 0.1,
    keys: [
      { at: 0, pose: 'ready' }, { at: 0.15, pose: ['ready', { hipL: 90, kneeL: 110, spine: -5 }] },
      { at: 0.27, pose: 'kick' }, { at: 0.4, pose: 'kick' }, { at: 0.7, pose: 'ready' },
    ],
  },
  duck: {
    id: 'duck', label: 'Duck', duration: 0.7, advance: 0, blend: 0.08,
    keys: [{ at: 0, pose: 'stand' }, { at: 0.15, pose: 'duck' }, { at: 0.5, pose: 'duck' }, { at: 0.7, pose: 'stand' }],
  },
  'hit-react': {
    id: 'hit-react', label: 'Hit React', duration: 0.7, contact: 0.04, advance: -45, blend: 0.05,
    keys: [{ at: 0, pose: 'stand' }, { at: 0.06, pose: 'hit-react' }, { at: 0.35, pose: 'hit-react' }, { at: 0.7, pose: 'stand' }],
  },
  throw: {
    id: 'throw', label: 'Throw', duration: 0.8, contact: 0.42, limb: 'armL', advance: 10, blend: 0.1,
    // Overhand: the throwing arm passes over the head (angles past -180 keep the direction).
    keys: [
      { at: 0, pose: 'stand' }, { at: 0.3, pose: 'throw-windup' },
      { at: 0.36, pose: ['throw-windup', { shoulderL: -190, elbowL: 40, spine: 0 }] },
      { at: 0.42, pose: ['stand', { shoulderL: -260, elbowL: 10, spine: 15, hipL: 25, kneeL: 15, hipR: -20 }] },
      { at: 0.55, pose: ['stand', { shoulderL: -300, elbowL: 20, spine: 20, hipL: 25, kneeL: 15, hipR: -20 }] },
      { at: 0.8, pose: ['stand', { shoulderL: -352 }] },
    ],
  },
  grab: {
    id: 'grab', label: 'Grab', duration: 0.6, contact: 0.25, limb: 'armR', advance: 10, blend: 0.1,
    keys: [
      { at: 0, pose: 'stand' }, { at: 0.25, pose: ['stand', { shoulderR: 80, elbowR: 10, spine: 15 }] },
      { at: 0.4, pose: ['stand', { shoulderR: 80, elbowR: 25, spine: 15 }] },
      { at: 0.6, pose: ['stand', { shoulderR: 30, elbowR: 100 }] },
    ],
  },
  land: {
    id: 'land', label: 'Land', duration: 0.5, contact: 0, advance: 0, blend: 0.05,
    keys: [{ at: 0, pose: 'crouch' }, { at: 0.5, pose: 'stand' }],
  },
  fall: {
    id: 'fall', label: 'Fall', duration: 1, contact: 0.85, advance: -60, blend: 0.08, hold: true,
    keys: [{ at: 0, pose: 'hit-react' }, { at: 0.4, pose: 'fall' }, { at: 0.85, pose: LYING }, { at: 1, pose: LYING }],
  },
};

/** One action on a figure's lane. Times are clip seconds. */
export interface SkeletonActionInstance {
  id: string;
  action: SkeletonActionId;
  start: number;
  duration: number;
  /** Scales how far the pose departs from standing (and the lift); 1 = as authored. */
  strength?: number;
  /** Aim the striking limb at a joint of another figure (`clipId|effectId`) around the contact. */
  target?: { figure: string; joint: SkeletonJoint };
  /** Forward travel in figure pixels; overrides the action's own distance (e.g. a short run). */
  distance?: number;
}

export const isSkeletonActionId = (value: unknown): value is SkeletonActionId =>
  typeof value === 'string' && (SKELETON_ACTION_IDS as readonly string[]).includes(value);

/** Parse the effect's stored action list; invalid entries are dropped, never thrown. */
export function parseSkeletonActions(raw: unknown): SkeletonActionInstance[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): SkeletonActionInstance[] => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Partial<SkeletonActionInstance>;
      if (typeof item.id !== 'string' || !isSkeletonActionId(item.action)) return [];
      if (!Number.isFinite(item.start) || !(Number(item.duration) > 0)) return [];
      return [{
        id: item.id, action: item.action, start: Number(item.start), duration: Number(item.duration),
        ...(Number.isFinite(item.strength) ? { strength: Number(item.strength) } : {}),
        ...(Number.isFinite(item.distance) ? { distance: Number(item.distance) } : {}),
        ...(item.target && typeof item.target.figure === 'string' && typeof item.target.joint === 'string'
          ? { target: { figure: item.target.figure, joint: item.target.joint } } : {}),
      }];
    }).sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

export const serializeSkeletonActions = (actions: readonly SkeletonActionInstance[]) =>
  JSON.stringify([...actions].sort((a, b) => a.start - b.start));

/**
 * Move a stored lane to a clip whose clock starts `delta` seconds later (the right part of a split,
 * a left trim). Actions keep their timeline position; ones that ended earlier stay with negative
 * starts so their travel still counts. Returns the input when there is nothing to shift.
 */
export function shiftSkeletonActions(raw: unknown, delta: number): unknown {
  const actions = parseSkeletonActions(raw);
  if (!actions.length || delta === 0 || !Number.isFinite(delta)) return raw;
  return serializeSkeletonActions(actions.map(action => ({ ...action, start: Math.round((action.start - delta) * 1e6) / 1e6 })));
}

const STAND = getSkeletonPosePreset('stand')!.pose;
/** Shortest signed turn from a to b in degrees, so blends never spin a joint the long way. */
const turn = (a: number, b: number) => ((b - a) % 360 + 540) % 360 - 180;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

function resolvePose(ref: PoseRef): Pose {
  if (typeof ref === 'string') return getSkeletonPosePreset(ref)?.pose ?? STAND;
  if (Array.isArray(ref)) return { ...resolvePose(ref[0] as string), ...(ref[1] as Partial<Pose>) };
  return { ...STAND, ...(ref as Partial<Pose>) };
}

export interface ActionSample { pose: Pose; lift: number }

/** The action's own pose at `local` seconds into it (clamped to its span). */
export function sampleSkeletonAction(instance: SkeletonActionInstance, local: number): ActionSample {
  const definition = SKELETON_ACTIONS[instance.action];
  const scale = definition.duration / instance.duration;
  const t = Math.max(0, Math.min(instance.duration, local)) * scale;
  let sample: ActionSample;
  if (definition.gait) {
    const gait = gaitPose(definition.gait.gait, t * definition.gait.speed, definition.gait.stride);
    sample = { pose: Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, gait[key]])) as Pose, lift: 0 };
  } else {
    const keys = definition.keys ?? [{ at: 0, pose: 'stand' }];
    let index = keys.findIndex(key => key.at > t);
    if (index === -1) index = keys.length;
    const from = keys[Math.max(0, index - 1)], to = keys[Math.min(keys.length - 1, index)];
    const span = to.at - from.at, mix = span > 0 ? smooth((t - from.at) / span) : 1;
    const a = resolvePose(from.pose), b = resolvePose(to.pose);
    sample = {
      pose: Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, a[key] + (b[key] - a[key]) * mix])) as Pose,
      lift: (from.lift ?? 0) + ((to.lift ?? 0) - (from.lift ?? 0)) * mix,
    };
  }
  const strength = instance.strength ?? 1;
  if (strength === 1) return sample;
  return {
    pose: Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, STAND[key] + (sample.pose[key] - STAND[key]) * strength])) as Pose,
    lift: sample.lift * strength,
  };
}

/** Blend weight of an action at a clip time: eases in and out inside its own span. */
export function skeletonActionWeight(instance: SkeletonActionInstance, time: number): number {
  const local = time - instance.start;
  const definition = SKELETON_ACTIONS[instance.action];
  if (local < 0 || (local > instance.duration && !definition.hold)) return 0;
  const blend = Math.min(definition.blend, instance.duration / 2);
  if (blend <= 0) return 1;
  // A holding action stays at full weight after its end; later actions blend over it.
  return definition.hold ? smooth(local / blend) : Math.min(smooth(local / blend), smooth((instance.duration - local) / blend));
}

/** Clip time of an action's contact, if it has one. */
export function skeletonActionContact(instance: SkeletonActionInstance): number | undefined {
  const definition = SKELETON_ACTIONS[instance.action];
  return definition.contact === undefined ? undefined : instance.start + definition.contact * instance.duration / definition.duration;
}

/** How strongly the striking limb is aimed at its target: peaks at the contact. */
export function skeletonActionAimWeight(instance: SkeletonActionInstance, time: number): number {
  const contact = skeletonActionContact(instance);
  if (contact === undefined || !instance.target || !SKELETON_ACTIONS[instance.action].limb) return 0;
  const reach = Math.min(0.15, instance.duration / 3);
  return smooth(1 - Math.abs(time - contact) / reach);
}

export interface ActionPoseResult { pose: Pose; lift: number; advance: number }

/**
 * Apply every action to a base pose at a clip time: active actions blend over it in start order
 * (overlaps cross-fade), and each action's forward travel accumulates as it plays.
 */
export function applySkeletonActions(base: Pose, baseLift: number, actions: readonly SkeletonActionInstance[], time: number): ActionPoseResult {
  let pose = { ...base }, lift = baseLift, advance = 0;
  for (const instance of actions) {
    const definition = SKELETON_ACTIONS[instance.action];
    const progress = Math.max(0, Math.min(1, (time - instance.start) / instance.duration));
    advance += (instance.distance ?? definition.advance) * (definition.gait ? progress : smooth(progress));
    const weight = skeletonActionWeight(instance, time);
    if (weight <= 0) continue;
    const sample = sampleSkeletonAction(instance, time - instance.start);
    pose = Object.fromEntries(SKELETON_ANGLE_KEYS.map(key => [key, pose[key] + turn(pose[key], sample.pose[key]) * weight])) as Pose;
    lift += (sample.lift - lift) * weight;
  }
  return { pose, lift, advance };
}
