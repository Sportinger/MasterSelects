// Blockify and Block Mosaic: cell-average pictures built from the same centred grid as Pixelate.
// The editable graphs are the runtime (services/operators/cellGridRecipes.ts); shader.wgsl is their WGSL reference.

import shader from './shader.wgsl?raw';
import common from './cellGridCommon.wgsl?raw';
import type { EffectDefinition, EffectParam } from '../types';
import { colorToRgba } from '../_shared/catalogColor';
import { BLOCKIFY_MAX_LEVELS, BLOCKIFY_MIN_LEVELS } from '../../services/operators/cellGridRecipes';
import { amountWarnings, cellSizeWarnings } from './cellGridParams';

type Params = Record<string, number | boolean | string>;
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

// Kept from the earlier catalog definition so saved projects and old tool calls still load; nothing reads them.
const retired = (effect: string, label: string, type: 'number' | 'color', fallback: number | string): EffectParam => ({
  type, label, default: fallback, ...(type === 'number' ? { min: -180, max: 180, step: 1, animatable: true } : {}),
  deprecated: `${effect} has no ${label.toLowerCase()} control; this value has no effect.`,
});
const amount: EffectParam = { type: 'number', label: 'Amount', default: 1, min: 0, max: 1, step: 0.01, animatable: true };

function packBlock(params: Params, width: number, height: number, time: number, scaleFallback: number): Float32Array {
  return new Float32Array([
    Math.max(1, width), Math.max(1, height),
    finite(params.scale, scaleFallback), finite(params.amount, 1),
    finite(params.levels, 6), finite(params.grout, 2),
    time, finite(params.speed, 0),
    ...colorToRgba(params.colorA, '#111827'),
  ]);
}

export const blockify: EffectDefinition = {
  id: 'blockify', name: 'Blockify', category: 'pixel',
  shader: `${common}\n${shader}`, entryPoint: 'blockifyFragment', uniformSize: 48,
  params: {
    scale: { type: 'number', label: 'Block Size', default: 16, min: 2, max: 128, step: 1, animatable: true },
    levels: { type: 'number', label: 'Levels', default: 6, min: BLOCKIFY_MIN_LEVELS, max: 16, step: 1, animatable: true, graphOnly: true },
    amount,
    angle: retired('Blockify', 'Angle', 'number', 0),
    colorA: retired('Blockify', 'Ink', 'color', '#111827'),
    colorB: retired('Blockify', 'Paper', 'color', '#f8fafc'),
  },
  paramWarnings: (params, width, height) => {
    const levels = params.levels;
    return [...cellSizeWarnings('scale', params.scale, 1, width, height), ...amountWarnings(params.amount),
      ...(typeof levels === 'number' && (levels < BLOCKIFY_MIN_LEVELS - .5 || levels >= BLOCKIFY_MAX_LEVELS + .5)
        ? [`levels: ${levels} is outside ${BLOCKIFY_MIN_LEVELS}–${BLOCKIFY_MAX_LEVELS}; Blockify uses ${levels < BLOCKIFY_MIN_LEVELS ? BLOCKIFY_MIN_LEVELS : BLOCKIFY_MAX_LEVELS}.`] : [])];
  },
  packUniforms: (params, width, height) => packBlock(params, width, height, 0, 16),
};

export const blockMosaic: EffectDefinition = {
  id: 'block-mosaic', name: 'Block Mosaic', category: 'pixel',
  shader: `${common}\n${shader}`, entryPoint: 'blockMosaicFragment', uniformSize: 48,
  params: {
    scale: { type: 'number', label: 'Tile Size', default: 22, min: 4, max: 128, step: 1, animatable: true },
    grout: { type: 'number', label: 'Grout Width', default: 2, min: 0, max: 12, step: 0.5, animatable: true, graphOnly: true },
    amount,
    colorA: { type: 'color', label: 'Grout Color', default: '#111827' },
    speed: { type: 'number', label: 'Speed', default: 1, min: 0, max: 5, step: 0.05, animatable: true },
    angle: retired('Block Mosaic', 'Angle', 'number', 0),
    colorB: retired('Block Mosaic', 'Paper', 'color', '#f8fafc'),
  },
  paramWarnings: (params, width, height) => [...cellSizeWarnings('scale', params.scale, 2, width, height), ...amountWarnings(params.amount),
    ...(typeof params.grout === 'number' && params.grout < 0 ? [`grout: ${params.grout} is below 0; Block Mosaic draws no grout.`] : [])],
  packUniforms: (params, width, height, time = 0) => packBlock(params, width, height, time, 22),
};
