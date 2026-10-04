/**
 * Stick-figure rig shared by the Stick Figure effect, the rig control nodes and Attach to Joint.
 * Figure-local pixels, y down, origin at the layer centre; the figure faces +x.
 *
 * Spine and head lean forward for positive angles; limb angles are measured from hanging straight
 * down, positive swinging forward; elbows and knees are flexion. Arms hang from the top of the
 * spine and follow its lean, legs hang from the pelvis.
 */
export const SKELETON_NUMERIC_KEYS = [
  'torso', 'neck', 'headRadius', 'upperArm', 'forearm', 'thigh', 'shin', 'thickness',
  'rootX', 'rootY', 'spine', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR',
  'hipL', 'kneeL', 'hipR', 'kneeR', 'groundY', 'lift',
] as const;
export type SkeletonNumericKey = typeof SKELETON_NUMERIC_KEYS[number];
/** off: free; floor: the figure never sinks below Ground Y; plant: its lowest point always stands on it. */
export type SkeletonGroundMode = 'off' | 'floor' | 'plant';
export type SkeletonShapeDefinition = Record<SkeletonNumericKey, number> & { groundMode: SkeletonGroundMode };

/**
 * Facing mirrors the figure around its pelvis, so Pelvis X stays a screen position: a figure at
 * +300 facing left stands on the right and looks left. The mapping is its own inverse.
 */
export const facingX = (x: number, rootX: number, facing: number) => rootX + facing * (x - rootX);

/** Figure units are pixels of a frame this tall; renders scale them to the actual height. */
export const STICK_FIGURE_REFERENCE_HEIGHT = 1080;

/** Read a skeleton from flat parameters (the Stick Figure effect uses the skeleton keys as names). */
export function skeletonFromParams(params: Readonly<Record<string, unknown>>): SkeletonShapeDefinition {
  const values: Partial<SkeletonShapeDefinition> = {};
  for (const key of SKELETON_NUMERIC_KEYS) if (typeof params[key] === 'number') values[key] = params[key] as number;
  if (params.groundMode === 'off' || params.groundMode === 'floor' || params.groundMode === 'plant') values.groundMode = params.groundMode;
  return normalizeSkeleton(values);
}

export function createDefaultSkeletonShape(): SkeletonShapeDefinition {
  return {
    torso: 110, neck: 14, headRadius: 26, upperArm: 62, forearm: 58, thigh: 74, shin: 70, thickness: 12,
    rootX: 0, rootY: 0, spine: 0, head: 0, shoulderL: 8, elbowL: 10, shoulderR: -8, elbowR: 10,
    hipL: 4, kneeL: 0, hipR: -4, kneeR: 0, groundY: 144, lift: 0, groundMode: 'plant',
  };
}

export const SKELETON_JOINTS = [
  'pelvis', 'neck', 'headBase', 'head', 'elbowL', 'handL', 'elbowR', 'handR', 'kneeL', 'footL', 'kneeR', 'footR',
] as const;
export type SkeletonJoint = typeof SKELETON_JOINTS[number];

/** Capsules drawn between joints (indices into SKELETON_JOINTS); the head is a circle at `head`. */
export const SKELETON_SEGMENTS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [1, 4], [4, 5], [1, 6], [6, 7], [0, 8], [8, 9], [0, 10], [10, 11],
];

export const SKELETON_ANGLE_KEYS = [
  'spine', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR',
] as const satisfies readonly SkeletonNumericKey[];
export type SkeletonAngleKey = typeof SKELETON_ANGLE_KEYS[number];
export const SKELETON_POSE_KEYS = ['rootX', 'rootY', ...SKELETON_ANGLE_KEYS] as const satisfies readonly SkeletonNumericKey[];
export type SkeletonPoseKey = typeof SKELETON_POSE_KEYS[number];
export const SKELETON_LENGTH_KEYS = [
  'torso', 'neck', 'headRadius', 'upperArm', 'forearm', 'thigh', 'shin', 'thickness',
] as const satisfies readonly SkeletonNumericKey[];

export const SKELETON_KEY_LABELS: Record<SkeletonNumericKey, string> = {
  torso: 'Torso', neck: 'Neck', headRadius: 'Head Radius', upperArm: 'Upper Arm', forearm: 'Forearm',
  thigh: 'Thigh', shin: 'Shin', thickness: 'Line Thickness', rootX: 'Pelvis X', rootY: 'Pelvis Y',
  spine: 'Spine Lean', head: 'Head Tilt', shoulderL: 'Shoulder L', elbowL: 'Elbow L', shoulderR: 'Shoulder R',
  elbowR: 'Elbow R', hipL: 'Hip L', kneeL: 'Knee L', hipR: 'Hip R', kneeR: 'Knee R', groundY: 'Ground Y', lift: 'Lift',
};

export const SKELETON_JOINT_LABELS: Record<SkeletonJoint, string> = {
  pelvis: 'Pelvis', neck: 'Neck', headBase: 'Chin', head: 'Head', elbowL: 'Elbow L', handL: 'Hand L',
  elbowR: 'Elbow R', handR: 'Hand R', kneeL: 'Knee L', footL: 'Foot L', kneeR: 'Knee R', footR: 'Foot R',
};

export const isSkeletonAngleKey = (key: string): key is SkeletonAngleKey => (SKELETON_ANGLE_KEYS as readonly string[]).includes(key);

export interface SkeletonPoint { x: number; y: number }

export interface SolvedSkeleton {
  joints: Record<SkeletonJoint, SkeletonPoint>;
  /** Screen direction (atan2 of y-down vectors, degrees) of the bone ending at each joint. */
  boneAngles: Record<SkeletonJoint, number>;
  /** Vertical shift the ground mode applied. */
  groundShift: number;
}

const RAD = Math.PI / 180;
const up = (degrees: number) => ({ x: Math.sin(degrees * RAD), y: -Math.cos(degrees * RAD) });
const down = (degrees: number) => ({ x: Math.sin(degrees * RAD), y: Math.cos(degrees * RAD) });
const along = (from: SkeletonPoint, direction: SkeletonPoint, length: number): SkeletonPoint =>
  ({ x: from.x + direction.x * length, y: from.y + direction.y * length });
const screenAngle = (direction: SkeletonPoint) => Math.atan2(direction.y, direction.x) / RAD;
const finiteOr = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Missing or invalid fields fall back to the defaults; lengths never go negative. */
export function normalizeSkeleton(skeleton?: Partial<SkeletonShapeDefinition>): SkeletonShapeDefinition {
  const defaults = createDefaultSkeletonShape();
  const result = { ...defaults } as SkeletonShapeDefinition;
  for (const key of SKELETON_NUMERIC_KEYS) {
    const value = finiteOr(skeleton?.[key], defaults[key]);
    result[key] = (SKELETON_LENGTH_KEYS as readonly string[]).includes(key) ? Math.max(0, value) : value;
  }
  const mode = skeleton?.groundMode;
  result.groundMode = mode === 'off' || mode === 'floor' || mode === 'plant' ? mode : defaults.groundMode;
  return result;
}

/** Forward kinematics plus ground snapping. */
export function solveSkeleton(input?: Partial<SkeletonShapeDefinition>): SolvedSkeleton {
  const s = normalizeSkeleton(input);
  const pelvis = { x: s.rootX, y: s.rootY };
  const torsoDir = up(s.spine), headDir = up(s.spine + s.head);
  const neck = along(pelvis, torsoDir, s.torso);
  const headBase = along(neck, headDir, s.neck);
  const head = along(neck, headDir, s.neck + s.headRadius);
  const limb = (root: SkeletonPoint, upper: number, lower: number, upperLength: number, lowerLength: number) => {
    const upperDir = down(upper), lowerDir = down(lower);
    const joint = along(root, upperDir, upperLength);
    return { joint, end: along(joint, lowerDir, lowerLength), upperDir, lowerDir };
  };
  // Arms follow the spine lean; elbows flex forward, knees flex backward.
  const armL = limb(neck, s.shoulderL - s.spine, s.shoulderL - s.spine + s.elbowL, s.upperArm, s.forearm);
  const armR = limb(neck, s.shoulderR - s.spine, s.shoulderR - s.spine + s.elbowR, s.upperArm, s.forearm);
  const legL = limb(pelvis, s.hipL, s.hipL - s.kneeL, s.thigh, s.shin);
  const legR = limb(pelvis, s.hipR, s.hipR - s.kneeR, s.thigh, s.shin);
  const joints: Record<SkeletonJoint, SkeletonPoint> = {
    pelvis, neck, headBase, head,
    elbowL: armL.joint, handL: armL.end, elbowR: armR.joint, handR: armR.end,
    kneeL: legL.joint, footL: legL.end, kneeR: legR.joint, footR: legR.end,
  };
  let groundShift = 0;
  if (s.groundMode !== 'off') {
    const radius = s.thickness / 2;
    let lowest = head.y + s.headRadius;
    for (const joint of SKELETON_JOINTS) if (joint !== 'head') lowest = Math.max(lowest, joints[joint].y + radius);
    groundShift = s.groundMode === 'plant' ? s.groundY - lowest : Math.min(0, s.groundY - lowest);
    if (groundShift !== 0) for (const joint of SKELETON_JOINTS) joints[joint] = { x: joints[joint].x, y: joints[joint].y + groundShift };
  }
  // Lift moves the whole figure after ground snapping (negative = up), so jumps work with Plant.
  if (s.lift !== 0) for (const joint of SKELETON_JOINTS) joints[joint] = { x: joints[joint].x, y: joints[joint].y + s.lift };
  const boneAngles: Record<SkeletonJoint, number> = {
    pelvis: screenAngle(torsoDir), neck: screenAngle(torsoDir), headBase: screenAngle(headDir), head: screenAngle(headDir),
    elbowL: screenAngle(armL.upperDir), handL: screenAngle(armL.lowerDir),
    elbowR: screenAngle(armR.upperDir), handR: screenAngle(armR.lowerDir),
    kneeL: screenAngle(legL.upperDir), footL: screenAngle(legL.lowerDir),
    kneeR: screenAngle(legR.upperDir), footR: screenAngle(legR.lowerDir),
  };
  return { joints, boneAngles, groundShift };
}

/** Symmetric half extents around the shape centre that contain every capsule and the head. */
export function skeletonHalfExtents(input?: Partial<SkeletonShapeDefinition>): { x: number; y: number } {
  const s = normalizeSkeleton(input);
  const { joints } = solveSkeleton(s);
  const radius = s.thickness / 2;
  let x = 1, y = 1;
  for (const joint of SKELETON_JOINTS) {
    const pad = joint === 'head' ? s.headRadius : radius;
    x = Math.max(x, Math.abs(joints[joint].x) + pad);
    y = Math.max(y, Math.abs(joints[joint].y) + pad);
  }
  return { x, y };
}

export type SkeletonLimb = 'legL' | 'legR' | 'armL' | 'armR';

/**
 * Two-bone IK for one limb. The target is relative to the limb root (hip for legs, top of the
 * spine for arms) in pixels. Natural bending puts knees forward and elbows back. Returns the
 * skeleton's own angle convention, ready to drive `shape.skeleton.*`.
 */
export function solveSkeletonLimb(input: Partial<SkeletonShapeDefinition> | undefined, limb: SkeletonLimb,
  targetX: number, targetY: number, reverse = false): { upper: number; lower: number; reach: number } {
  const s = normalizeSkeleton(input);
  const leg = limb === 'legL' || limb === 'legR';
  const upperLength = leg ? s.thigh : s.upperArm, lowerLength = leg ? s.shin : s.forearm;
  if (!(upperLength > 0) || !(lowerLength > 0)) throw new Error('Limb bones must be longer than zero.');
  const distance = Math.hypot(targetX, targetY), maxReach = upperLength + lowerLength;
  const reach = Math.min(1, distance / maxReach);
  const d = Math.min(Math.max(distance, Math.abs(upperLength - lowerLength)), maxReach);
  const base = distance > 0 ? Math.atan2(targetY, targetX) : Math.PI / 2;
  const cosA = d > 0 ? (upperLength * upperLength + d * d - lowerLength * lowerLength) / (2 * upperLength * d) : 1;
  const spread = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // In y-down screen space a positive spread swings the joint clockwise of the root->target line.
  // For a downward leg that is toward -x, so knees (forward, +x) take the negative side.
  const sign = (leg ? -1 : 1) * (reverse ? -1 : 1);
  const a1 = base + sign * spread;
  const joint = { x: Math.cos(a1) * upperLength, y: Math.sin(a1) * upperLength };
  const end = { x: Math.cos(base) * d, y: Math.sin(base) * d };
  const upperAngle = Math.atan2(joint.x, joint.y) / RAD;
  const lowerAngle = Math.atan2(end.x - joint.x, end.y - joint.y) / RAD;
  const wrap = (value: number) => { const wrapped = ((value + 180) % 360 + 360) % 360 - 180; return wrapped === -180 ? 180 : wrapped; };
  return leg
    ? { upper: wrap(upperAngle), lower: wrap(upperAngle - lowerAngle), reach }
    : { upper: wrap(upperAngle + s.spine), lower: wrap(lowerAngle - upperAngle), reach };
}

export type SkeletonGait = 'walk' | 'run' | 'idle';
export type GaitPose = Record<SkeletonAngleKey, number> & { bounce: number; contactL: number; contactR: number };

/**
 * Procedural gait at a phase in cycles (fractional part used). Stride scales the swing, Lean adds
 * to the spine. Pure function of its inputs, so scrubbing and export agree.
 */
export function gaitPose(gait: SkeletonGait, phase: number, stride = 1, lean = 0): GaitPose {
  const t = 2 * Math.PI * (phase - Math.floor(phase));
  const sin = Math.sin(t), cos = Math.cos(t);
  const pos = (value: number) => Math.max(0, value);
  if (gait === 'idle') {
    const breath = Math.sin(t);
    return {
      spine: 2 + lean + 1.5 * breath * stride, head: -1 + 1.5 * Math.sin(t + 0.6) * stride,
      shoulderL: 7 + 2 * breath * stride, elbowL: 12 + 3 * breath * stride,
      shoulderR: -7 - 2 * breath * stride, elbowR: 12 + 3 * breath * stride,
      hipL: 4, kneeL: 4 + 2 * pos(breath) * stride, hipR: -4, kneeR: 4 + 2 * pos(breath) * stride,
      bounce: 1.5 * breath * stride, contactL: 1, contactR: 1,
    };
  }
  const run = gait === 'run';
  const leg = (s: number, c: number) => run
    ? { hip: 10 + 38 * stride * s, knee: 18 + 80 * stride * pos(Math.cos(Math.atan2(s, c) + 0.5)) ** 1.5 + 12 * pos(-c) * stride }
    : { hip: 22 * stride * s, knee: 6 + 40 * stride * pos(Math.cos(Math.atan2(s, c) + 0.35)) ** 2 + 8 * pos(Math.cos(Math.atan2(s, c) - 2)) ** 4 };
  const left = leg(sin, cos), right = leg(-sin, -cos);
  const swing = (run ? 45 : 18) * stride;
  return {
    spine: (run ? 14 : 4) + lean + (run ? 2 : 1.5) * Math.sin(2 * t), head: run ? -8 : -2,
    shoulderL: -swing * sin + (run ? 5 : 0), elbowL: run ? 85 + 10 * stride * sin : 12 + 14 * stride * pos(-sin),
    shoulderR: swing * sin + (run ? 5 : 0), elbowR: run ? 85 - 10 * stride * sin : 12 + 14 * stride * pos(sin),
    hipL: left.hip, kneeL: left.knee, hipR: right.hip, kneeR: right.knee,
    bounce: -(run ? 10 : 4) * stride * Math.cos(2 * t),
    contactL: cos < (run ? -0.35 : 0.1) ? 1 : 0, contactR: -cos < (run ? -0.35 : 0.1) ? 1 : 0,
  };
}

export interface SkeletonPosePreset { id: string; name: string; pose: Record<SkeletonAngleKey, number> }

const pose = (id: string, name: string, values: number[]): SkeletonPosePreset => ({
  id, name, pose: Object.fromEntries(SKELETON_ANGLE_KEYS.map((key, index) => [key, values[index]])) as Record<SkeletonAngleKey, number>,
});

/** Built-in poses: spine, head, shoulder L, elbow L, shoulder R, elbow R, hip L, knee L, hip R, knee R. */
export const SKELETON_POSE_PRESETS: readonly SkeletonPosePreset[] = [
  pose('stand', 'Stand', [0, 0, 8, 10, -8, 10, 4, 0, -4, 0]),
  pose('ready', 'Fight Stance', [8, -6, 60, 100, 35, 110, 22, 25, -18, 20]),
  pose('run-contact', 'Run Contact', [14, -8, -40, 85, 50, 90, 38, 10, -30, 60]),
  pose('run-passing', 'Run Passing', [14, -8, 5, 90, 5, 90, 5, 15, 30, 110]),
  pose('crouch', 'Crouch', [25, -15, 40, 60, 30, 70, 75, 120, 60, 110]),
  pose('jump-air', 'Jump Air', [5, -5, 150, 20, 140, 25, 50, 90, 20, 70]),
  pose('punch', 'Punch', [12, -5, 88, 5, 30, 120, 25, 15, -20, 10]),
  pose('kick', 'Kick', [-20, 10, 30, 60, -30, 60, 95, 5, -5, 10]),
  pose('duck', 'Duck', [50, -30, 70, 120, 60, 125, 80, 130, 70, 125]),
  pose('throw-windup', 'Throw Wind-up', [-10, 0, -120, 70, 60, 40, 20, 15, -20, 5]),
  pose('hit-react', 'Hit React', [-25, 20, -30, 30, 40, 40, -10, 15, 15, 20]),
  pose('fall', 'Fall', [-70, 20, 120, 20, 160, 15, 40, 30, 10, 20]),
  pose('wave', 'Wave', [0, 0, 8, 10, 150, 40, 4, 0, -4, 0]),
];

export function getSkeletonPosePreset(id: string): SkeletonPosePreset | undefined {
  return SKELETON_POSE_PRESETS.find(preset => preset.id === id);
}
