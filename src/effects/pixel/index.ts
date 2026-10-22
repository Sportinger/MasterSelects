// Blockify and Block Mosaic: cell-average pictures built from the same centred grid as Pixelate.
// The editable graphs are the runtime (services/operators/cellGridRecipes.ts); shader.wgsl is their WGSL reference.

import shader from './shader.wgsl?raw';
import common from './cellGridCommon.wgsl?raw';
import type { EffectDefinition, EffectParam, EffectPreset } from '../types';
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
    finite(params.levels, 8), finite(params.grout, 2),
    time, finite(params.speed, 0),
    finite(params.dither, 0.5), 0, 0, 0,
    ...colorToRgba(params.colorA, '#111827'),
  ]);
}

/** Blockify's named starting points (the Preset row of its card; docs/Features/effects/blockify.md). */
export const BLOCKIFY_PRESETS: readonly EffectPreset[] = [
  // Small blocks and six shades per colour: detail stays readable, gradients break into a soft checker.
  { id: 'sixteen-bit', name: '16-Bit', params: { scale: 8, levels: 6 } },
  // Chunky blocks, four shades per colour and a strong checker where shades change.
  { id: 'arcade', name: 'Arcade', params: { scale: 20, levels: 4, dither: 0.75 } },
  // Two shades per colour: black, white and six pure colours, dithered in between.
  { id: 'home-computer', name: 'Home Computer', params: { scale: 10, levels: 2, dither: 1 } },
  // Large flat blocks laid half over the original picture.
  { id: 'block-veil', name: 'Block Veil', params: { scale: 48, levels: 5, dither: 0, amount: 0.5 } },
];

export const blockify: EffectDefinition = {
  id: 'blockify', name: 'Blockify', category: 'pixel',
  shader: `${common}\n${shader}`, entryPoint: 'blockifyFragment', uniformSize: 64,
  params: {
    scale: { type: 'number', label: 'Block Size', default: 16, min: 2, max: 128, step: 1, animatable: true, unit: ' px' },
    // Steps per channel: 8 (512 colours) with half dither keeps dark, low-key footage calm; fewer is a harder poster look.
    // The slider spans the whole range the recipe uses (2–64); values outside are clamped and reported.
    levels: { type: 'number', label: 'Levels', default: 8, min: BLOCKIFY_MIN_LEVELS, max: BLOCKIFY_MAX_LEVELS, step: 1, animatable: true, graphOnly: true },
    // Ordered 4 × 4 Bayer dither per block before rounding: 0 rounds to the nearest level (flat bands), 1 a full retro
    // checker; 0.5 breaks the bands where shades change and keeps flat stage haze calm. It fades out below one level
    // step, so black stays black.
    dither: { type: 'number', label: 'Dither', default: 0.5, min: 0, max: 1, step: 0.01, animatable: true, graphOnly: true },
    amount,
    angle: retired('Blockify', 'Angle', 'number', 0),
    colorA: retired('Blockify', 'Ink', 'color', '#111827'),
    colorB: retired('Blockify', 'Paper', 'color', '#f8fafc'),
  },
  paramWarnings: (params, width, height) => {
    const levels = params.levels;
    const dither = params.dither;
    return [...cellSizeWarnings('scale', params.scale, 1, width, height, 'blocks are 1 pixel wide, so only the colour levels apply'),
      ...amountWarnings(params.amount),
      ...(typeof levels === 'number' && (levels < BLOCKIFY_MIN_LEVELS - .5 || levels >= BLOCKIFY_MAX_LEVELS + .5)
        ? [`levels: ${levels} is outside ${BLOCKIFY_MIN_LEVELS}–${BLOCKIFY_MAX_LEVELS}; Blockify uses ${levels < BLOCKIFY_MIN_LEVELS ? BLOCKIFY_MIN_LEVELS : BLOCKIFY_MAX_LEVELS}.`] : []),
      ...(typeof dither === 'number' && (dither < 0 || dither > 1) ? [`dither: ${dither} is outside 0–1; Blockify uses ${dither < 0 ? 0 : 1}.`] : [])];
  },
  presets: BLOCKIFY_PRESETS,
  packUniforms: (params, width, height) => packBlock(params, width, height, 0, 16),
};

export const blockMosaic: EffectDefinition = {
  id: 'block-mosaic', name: 'Block Mosaic', category: 'pixel',
  // Reshuffles on the timeline clock (seek and export repeat it), never on wall-clock time.
  requiresContinuousRender: false,
  shader: `${common}\n${shader}`, entryPoint: 'blockMosaicFragment', uniformSize: 64,
  params: {
    scale: { type: 'number', label: 'Tile Size', default: 22, min: 4, max: 128, step: 1, animatable: true },
    grout: { type: 'number', label: 'Grout Width', default: 2, min: 0, max: 12, step: 0.5, animatable: true, graphOnly: true },
    colorA: { type: 'color', label: 'Grout Color', default: '#111827' },
    // Large-tile reshuffles per second; 0 keeps the layout still until animated.
    speed: { type: 'number', label: 'Speed', default: 0, min: 0, max: 5, step: 0.05, animatable: true },
    amount,
    angle: retired('Block Mosaic', 'Angle', 'number', 0),
    colorB: retired('Block Mosaic', 'Paper', 'color', '#f8fafc'),
  },
  paramWarnings: (params, width, height) => [...cellSizeWarnings('scale', params.scale, 2, width, height, 'tiles are 2 pixels wide'), ...amountWarnings(params.amount),
    ...(typeof params.grout === 'number' && params.grout < 0 ? [`grout: ${params.grout} is below 0; Block Mosaic draws no grout.`] : [])],
  packUniforms: (params, width, height, time = 0) => packBlock(params, width, height, time, 22),
};
