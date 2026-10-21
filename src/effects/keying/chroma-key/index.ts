// Chroma Key: screen-matte keyer with an automatic screen colour and screen subtraction.
// Rendering is owned by the editable operator graph (services/operators/chromaKeyEffectGraph.ts);
// the editor never renders shader.wgsl. It is the single-pass core of that graph with a fixed screen
// colour (no automatic estimate, no screen subtraction, no edge kernel) and documents the matte maths.

import shader from './shader.wgsl?raw';
import type { EffectDefinition } from '../../types';
import {
  CHROMA_KEY_BLUE_PRIOR, CHROMA_KEY_DEFAULT_SCREEN_COLOR, CHROMA_KEY_GREEN_PRIOR, CHROMA_KEY_MAX_EDGE_PX,
  chromaKeyHexColor, chromaKeyNumbers, chromaKeyPrimaryChannel, chromaKeyScreen, chromaKeySpillMethod,
} from './keyerContract';

const RETIRED = 'Retired with the screen-matte keyer; use Clip Black and Clip White. Only Chroma Key graphs edited before the rebuild still read it.';

export const chromaKey: EffectDefinition = {
  id: 'chroma-key',
  name: 'Chroma Key',
  category: 'keying',

  shader,
  entryPoint: 'chromaKeyFragment',
  uniformSize: 48,

  params: {
    keyColor: {
      type: 'select',
      label: 'Screen',
      default: 'green',
      options: [
        { value: 'green', label: 'Green screen' },
        { value: 'blue', label: 'Blue screen' },
        { value: 'custom', label: 'Picked color' },
      ],
    },
    screenColor: { type: 'color', label: 'Screen color', default: CHROMA_KEY_DEFAULT_SCREEN_COLOR },
    clipBlack: { type: 'number', label: 'Clip Black', default: 0.3, min: 0, max: 1, step: 0.01, animatable: true },
    clipWhite: { type: 'number', label: 'Clip White', default: 0.85, min: 0, max: 1, step: 0.01, animatable: true },
    edgeShrink: { type: 'number', label: 'Shrink / Grow', default: 0, min: -CHROMA_KEY_MAX_EDGE_PX, max: CHROMA_KEY_MAX_EDGE_PX, step: 0.1, animatable: true },
    edgeSoftness: { type: 'number', label: 'Edge Softness', default: 0, min: 0, max: CHROMA_KEY_MAX_EDGE_PX, step: 0.1, animatable: true },
    spillSuppression: { type: 'number', label: 'Spill Suppression', default: 1, min: 0, max: 1, step: 0.01, animatable: true },
    spillMethod: {
      type: 'select',
      label: 'Spill Method',
      default: 'average',
      options: [{ value: 'average', label: 'Neutral' }, { value: 'max', label: 'Gentle (keeps yellows)' }],
    },
    view: {
      type: 'select',
      label: 'View',
      default: 'result',
      options: [{ value: 'result', label: 'Final result' }, { value: 'matte', label: 'Matte' }],
    },
    tolerance: { type: 'number', label: 'Tolerance', default: 0.2, min: 0, max: 1, step: 0.01, animatable: false, hidden: true, deprecated: RETIRED },
    softness: { type: 'number', label: 'Edge Softness (retired)', default: 0.1, min: 0, max: 0.5, step: 0.01, animatable: false, hidden: true, deprecated: RETIRED },
  },

  packUniforms: (params) => {
    const screen = chromaKeyScreen(params.keyColor);
    const color = screen === 'custom' ? chromaKeyHexColor(params.screenColor) : screen === 'blue' ? [...CHROMA_KEY_BLUE_PRIOR] : [...CHROMA_KEY_GREEN_PRIOR];
    const primary = chromaKeyPrimaryChannel(color);
    const numbers = chromaKeyNumbers(params);
    return new Float32Array([
      color[0], color[1], color[2], 0,
      primary === 0 ? 1 : 0, primary === 1 ? 1 : 0, primary === 2 ? 1 : 0, 0,
      numbers.clipBlack, numbers.clipWhite, numbers.spill, chromaKeySpillMethod(params.spillMethod) === 'max' ? 1 : 0,
    ]);
  },
};
