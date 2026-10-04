// Stick Figure Effect - a posable stick figure drawn over the clip (use a Blank clip for a bare figure)

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { colorToRgba } from '../../_shared/catalogColor';
import {
  facingX,
  figureMirror,
  SKELETON_JOINTS,
  skeletonFromParams,
  solveSkeleton,
  STICK_FIGURE_REFERENCE_HEIGHT,
} from '../../../services/rig/skeletonRig';
import { STICK_FIGURE_PARAMS } from './params';

export const stickFigure: EffectDefinition = {
  id: 'stick-figure',
  name: 'Stick Figure',
  category: 'generate',

  shader,
  entryPoint: 'stickFigureFragment',
  uniformSize: 144,

  params: STICK_FIGURE_PARAMS,
  extraControls: () => import('./StickFigureControls'),

  packUniforms: (params, width, height) => {
    const skeleton = skeletonFromParams(params);
    const { joints } = solveSkeleton(skeleton);
    const unit = height > 0 ? height / STICK_FIGURE_REFERENCE_HEIGHT : 1;
    const facing = figureMirror(params);
    const [r, g, b, a] = colorToRgba(params.color, '#ffffff');
    const opacity = typeof params.opacity === 'number' && Number.isFinite(params.opacity) ? params.opacity : 1;
    const data = new Float32Array(36);
    data.set([width, height, Math.max(0.5, skeleton.thickness * unit / 2), Math.max(0.5, skeleton.headRadius * unit),
      r, g, b, a, opacity, 0, 0, 0]);
    SKELETON_JOINTS.forEach((joint, index) => {
      data[12 + index * 2] = width / 2 + facingX(joints[joint].x, skeleton.rootX, facing) * unit;
      data[13 + index * 2] = height / 2 + joints[joint].y * unit;
    });
    return data;
  },
};
