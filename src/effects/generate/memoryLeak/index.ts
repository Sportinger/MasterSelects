// Memory Leak generator: shows leftover bytes of the FFmpeg wasm heap as if
// they were pixel data. Real memory, not noise: browsers zero fresh
// allocations, but freed wasm allocations keep their previous contents.

import shader from './shader.wgsl?raw';
import type { EffectParam, FullscreenEffectDefinition } from '../../types';
import type { ByteTextureContext, ByteTextureUpload } from '../../_shared/byteTexture';
import { depthParam, numberParam, planMemoryWindow } from './memoryWindow';
import { buildMemoryWindow, resolveMemorySource } from './memorySource';

type Primitive = number | boolean | string;

export const MEMORY_LEAK_EFFECT_ID = 'memory-leak';

const PARAMS: Record<string, EffectParam> = {
  size: {
    type: 'number', label: 'Block Width', default: 320, min: 8, max: 1024, step: 1,
    animatable: true, group: 'Memory',
  },
  depth: {
    type: 'select', label: 'Bit Depth', default: '8', group: 'Memory',
    options: [
      { value: '8', label: 'Zesty (8-bit)' },
      { value: '16', label: 'Cloudy (16-bit)' },
      { value: '32', label: 'Tripping (32-bit float)' },
    ],
  },
  offset: {
    type: 'number', label: 'Offset (MB)', default: 0, min: 0, max: 4096, step: 0.01,
    animatable: true, group: 'Memory',
  },
  motion: {
    type: 'select', label: 'Per Frame', default: 'advance', group: 'Motion',
    options: [
      { value: 'static', label: 'Hold block' },
      { value: 'advance', label: 'Advance' },
      { value: 'shuffle', label: 'Shuffle' },
    ],
  },
  stride: {
    type: 'number', label: 'Advance (KB)', default: 64, min: 1, max: 65536, step: 1,
    animatable: false, group: 'Motion',
  },
  seed: {
    type: 'number', label: 'Seed', default: 1, min: 0, max: 9999, step: 1,
    animatable: false, group: 'Motion',
  },
  floatMode: {
    type: 'select', label: 'Float Mapping', default: 'wrap', group: 'Style',
    options: [
      { value: 'clamp', label: 'Clamp' },
      { value: 'wrap', label: 'Wrap' },
      { value: 'abs', label: 'Absolute' },
    ],
  },
  floatGain: {
    type: 'number', label: 'Float Gain', default: 1, min: 0.001, max: 1000, step: 0.001,
    animatable: true, group: 'Style',
  },
  opaque: { type: 'boolean', label: 'Ignore Alpha', default: true, group: 'Style' },
  mix: {
    type: 'number', label: 'Mix', default: 1, min: 0, max: 1, step: 0.01,
    animatable: true, group: 'Style',
  },
  snapshot: { type: 'text', label: 'Frozen Block', default: '', hidden: true },
};

const DEPTH_INDEX = { '8': 0, '16': 1, '32': 2 } as const;
const FLOAT_MODE_INDEX: Record<string, number> = { clamp: 0, wrap: 1, abs: 2 };

function provideByteTexture(
  params: Record<string, Primitive>,
  context: ByteTextureContext,
): ByteTextureUpload | null {
  const window = buildMemoryWindow(params, context.width, context.height, context.timelineTimeSeconds, context.frameRate);
  if (!window) return null;
  return {
    data: window.data,
    width: window.plan.wordsPerRow,
    height: window.plan.memRows,
    version: `${window.source.key}:${window.offset}:${window.plan.wordsPerRow}x${window.plan.memRows}`,
  };
}

export const memoryLeak: FullscreenEffectDefinition = {
  id: MEMORY_LEAK_EFFECT_ID,
  name: 'Memory Leak',
  category: 'generate',
  shader,
  entryPoint: 'memoryLeakFragment',
  uniformSize: 48,
  params: PARAMS,
  byteTexture: provideByteTexture,
  extraControls: () => import('./MemoryLeakControls'),
  packUniforms: (params, width, height) => {
    const plan = planMemoryWindow(params, width, height);
    const available = resolveMemorySource(params) ? 1 : 0;
    const floatMode = FLOAT_MODE_INDEX[String(params.floatMode ?? 'wrap')] ?? 1;
    return new Float32Array([
      width, height,
      plan.memWidth, plan.memRows,
      DEPTH_INDEX[depthParam(params)],
      available,
      Math.max(0, Math.min(1, numberParam(params, 'mix', 1))),
      params.opaque === false ? 0 : 1,
      floatMode,
      Math.max(0.001, numberParam(params, 'floatGain', 1)),
      0, 0,
    ]);
  },
};
