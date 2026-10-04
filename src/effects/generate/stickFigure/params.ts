// Stick Figure parameters, shared by the effect and its node-drivable targets.

import type { EffectParam } from '../../types';
import {
  createDefaultSkeletonShape,
  SKELETON_KEY_LABELS,
  type SkeletonNumericKey,
} from '../../../services/rig/skeletonRig';

const DEFAULTS = createDefaultSkeletonShape();
const number = (key: SkeletonNumericKey, group: string, min: number, max: number): EffectParam => ({
  type: 'number', label: SKELETON_KEY_LABELS[key], default: DEFAULTS[key], min, max, step: 1, animatable: true, group,
});
const angle = (key: SkeletonNumericKey) => number(key, 'Pose', -180, 180);
const length = (key: SkeletonNumericKey, max = 400) => number(key, 'Proportions', 0, max);

/** Lengths and offsets are pixels at a 1080 px tall frame; the figure scales with the resolution. */
export const STICK_FIGURE_PARAMS = {
  rootX: number('rootX', 'Pose', -2000, 2000),
  rootY: number('rootY', 'Pose', -2000, 2000),
  spine: angle('spine'), head: angle('head'),
  shoulderL: angle('shoulderL'), elbowL: angle('elbowL'), shoulderR: angle('shoulderR'), elbowR: angle('elbowR'),
  hipL: angle('hipL'), kneeL: angle('kneeL'), hipR: angle('hipR'), kneeR: angle('kneeR'),
  torso: length('torso'), neck: length('neck', 200), headRadius: length('headRadius', 200),
  upperArm: length('upperArm'), forearm: length('forearm'), thigh: length('thigh'), shin: length('shin'),
  thickness: length('thickness', 100),
  groundMode: {
    type: 'select', label: 'Ground', default: DEFAULTS.groundMode, group: 'Ground',
    options: [
      { value: 'plant', label: 'Plant lowest point' },
      { value: 'floor', label: 'Keep above ground' },
      { value: 'off', label: 'Off' },
    ],
  },
  groundY: number('groundY', 'Ground', -2000, 2000),
  facing: {
    type: 'select', label: 'Facing', default: 'right', group: 'Style',
    options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }],
  },
  color: { type: 'color', label: 'Color', default: '#ffffff', group: 'Style' },
  opacity: { type: 'number', label: 'Opacity', default: 1, min: 0, max: 1, step: 0.01, animatable: true, group: 'Style' },
} satisfies Record<string, EffectParam>;
