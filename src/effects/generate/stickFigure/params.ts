// Stick Figure parameters, shared by the effect and its node-drivable targets.

import type { EffectParam } from '../../types';
import {
  createDefaultSkeletonShape,
  SKELETON_COORDINATE_LIMIT,
  SKELETON_KEY_LABELS,
  type SkeletonNumericKey,
} from '../../../services/rig/skeletonRig';

const DEFAULTS = createDefaultSkeletonShape();
/** A new Stick Figure starts in an open stance (arms away from the body, a step), so it reads as a
 * figure instead of one vertical stroke. Figures saved without a joint render the rig's rest pose
 * (skeletonFromParams), which `legacyDefault` shows; the rig defaults themselves are unchanged. */
export const STICK_FIGURE_NEW_POSE: Partial<Record<SkeletonNumericKey, number>> = {
  spine: 4, head: -4, shoulderL: 30, elbowL: 35, shoulderR: -25, elbowR: 20, hipL: 16, kneeL: 18, hipR: -12, kneeR: 6,
};
const number = (key: SkeletonNumericKey, group: string, min: number, max: number, extra: Partial<EffectParam>): EffectParam => {
  const pose = STICK_FIGURE_NEW_POSE[key];
  return {
    type: 'number', label: SKELETON_KEY_LABELS[key], default: pose ?? DEFAULTS[key], min, max, step: 1, animatable: true, group,
    ...(pose !== undefined && pose !== DEFAULTS[key] ? { legacyDefault: DEFAULTS[key] } : {}), ...extra,
  };
};
// Angles turn freely (any number of degrees); positions and lengths are figure pixels, which the rig
// keeps within ±SKELETON_COORDINATE_LIMIT so a runaway keyframe or driver never breaks the drawing.
const angle = (key: SkeletonNumericKey) => number(key, 'Pose', -180, 180, { unit: '°' });
const position = (key: SkeletonNumericKey, group: string) => number(key, group, -2000, 2000,
  { unit: ' px', renderMin: -SKELETON_COORDINATE_LIMIT, renderMax: SKELETON_COORDINATE_LIMIT });
const length = (key: SkeletonNumericKey, max = 400) => number(key, 'Proportions', 0, max,
  { unit: ' px', renderMin: 0, renderMax: SKELETON_COORDINATE_LIMIT });

/** Lengths and offsets are pixels at a 1080 px tall frame; the figure scales with the resolution. */
export const STICK_FIGURE_PARAMS = {
  // Where the figure stands, how big and which way it faces are set for the shot: presets keep them.
  rootX: { ...position('rootX', 'Pose'), presetKeeps: true },
  rootY: { ...position('rootY', 'Pose'), presetKeeps: true },
  lift: position('lift', 'Pose'),
  spine: angle('spine'), head: angle('head'),
  shoulderL: angle('shoulderL'), elbowL: angle('elbowL'), shoulderR: angle('shoulderR'), elbowR: angle('elbowR'),
  hipL: angle('hipL'), kneeL: angle('kneeL'), hipR: angle('hipR'), kneeR: angle('kneeR'),
  torso: length('torso'), neck: length('neck', 200), headRadius: length('headRadius', 200),
  upperArm: length('upperArm'), forearm: length('forearm'), thigh: length('thigh'), shin: length('shin'),
  thickness: length('thickness', 100),
  // At or below 0 the figure has no size (reported by stickFigureWarnings).
  scale: { type: 'number', label: 'Scale', default: 1, min: 0.05, max: 5, step: 0.01, animatable: true, group: 'Proportions', presetKeeps: true },
  groundMode: {
    // Ground and Ground Y are the stage floor of the shot: presets keep them, like the figure's position.
    type: 'select', label: 'Ground', default: DEFAULTS.groundMode, group: 'Ground', presetKeeps: true,
    options: [
      { value: 'plant', label: 'Plant lowest point' },
      { value: 'floor', label: 'Keep above ground' },
      { value: 'off', label: 'Off' },
    ],
  },
  groundY: { ...position('groundY', 'Ground'), presetKeeps: true },
  facing: {
    type: 'select', label: 'Facing', default: 'right', group: 'Style', presetKeeps: true,
    options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }],
  },
  // Keyframeable turnaround: 1 = as Facing says, -1 = turned around, in between a 2D squash.
  turn: { type: 'number', label: 'Turn', default: 1, min: -1, max: 1, step: 0.01, animatable: true, group: 'Style', renderMin: -1, renderMax: 1 },
  // Filled is the original disc; Ring draws the head as a circle outline with the limb thickness.
  headStyle: {
    type: 'select', label: 'Head', default: 'filled', group: 'Style',
    options: [{ value: 'filled', label: 'Filled' }, { value: 'ring', label: 'Ring' }],
  },
  color: { type: 'color', label: 'Color', default: '#ffffff', group: 'Style' },
  opacity: { type: 'number', label: 'Opacity', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style', renderMin: 0, renderMax: 1 },
  // Action lane (JSON list of SkeletonActionInstance), edited in the Actions section.
  actions: { type: 'text', label: 'Actions', default: '[]', hidden: true },
  // Ids of the timeline markers last created from the contacts (see syncStickFigureContactMarkers).
  contactMarkers: { type: 'text', label: 'Contact markers', default: '[]', hidden: true },
} satisfies Record<string, EffectParam>;
