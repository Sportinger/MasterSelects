// Stick Figure Effect - a posable stick figure drawn over the clip (use a Blank clip for a bare figure)

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import { colorToRgba } from '../../_shared/catalogColor';
import { STICK_FIGURE_PARAMS } from './params';
import { STICK_FIGURE_PRESETS } from './presets';
import { stickFigureLayout, stickFigureRing, stickFigureWarnings } from './layout';
import { generatorChoiceWarnings } from '../generatorParams';

export const stickFigure: EffectDefinition = {
  id: 'stick-figure',
  name: 'Stick Figure',
  category: 'generate',

  shader,
  entryPoint: 'stickFigureFragment',
  uniformSize: 144,

  params: STICK_FIGURE_PARAMS,
  presets: STICK_FIGURE_PRESETS,
  extraControls: () => import('./StickFigureControls'),
  // Clamps of number params are reported from renderMin/renderMax (paramRangeNotes).
  paramWarnings: (params, width, height) => [...stickFigureWarnings(params, width, height),
    ...generatorChoiceWarnings(STICK_FIGURE_PARAMS, params, ['headStyle', 'facing', 'groundMode'])],

  packUniforms: (params, width, height) => {
    const { joints, limbRadius, headRadius } = stickFigureLayout(params, width, height);
    const [r, g, b, a] = colorToRgba(params.color, '#ffffff');
    const opacity = typeof params.opacity === 'number' && Number.isFinite(params.opacity) ? params.opacity : 1;
    const ring = stickFigureRing(limbRadius, headRadius);
    const data = new Float32Array(36);
    data.set([width, height, limbRadius, headRadius, r, g, b, a, opacity, params.headStyle === 'ring' ? 1 : 0, ring.centre, ring.halfStroke]);
    joints.forEach((joint, index) => {
      data[12 + index * 2] = joint.x;
      data[13 + index * 2] = joint.y;
    });
    return data;
  },
};
