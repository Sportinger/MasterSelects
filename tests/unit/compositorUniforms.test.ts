import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/types/layers';
import {
  COMPOSITOR_UNIFORM_FLOAT_COUNT,
  writeLayerUniformData,
} from '../../src/engine/pipeline/compositor/uniforms';

function createLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    source: null,
    effects: [],
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    ...overrides,
  };
}

function readRepoText(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractFunctionBody(source: string, functionName: string): string {
  const start = source.indexOf(`fn ${functionName}`);
  expect(start).toBeGreaterThanOrEqual(0);

  const openBrace = source.indexOf('{', start);
  expect(openBrace).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBrace + 1, index);
      }
    }
  }

  throw new Error(`Could not extract ${functionName} body`);
}

function normalizeWgsl(source: string): string {
  return source
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTransitionTypes(source: string): number[] {
  return Array.from(source.matchAll(/transitionType == (\d+)u/g), (match) => Number(match[1]));
}

const EXPECTED_COMPOSITOR_TRANSITION_TYPES = [
  0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24,
];
const EXPECTED_COMPOSITOR_DISTORTION_TYPES = [25, 26];

describe('compositor uniforms', () => {
  it('keeps normal and external video transition shader branches in parity', () => {
    const normalShader = readRepoText('src/shaders/composite.wgsl');
    const externalShader = readRepoText('src/engine/pipeline/compositor/externalCompositeShader.ts');
    const normalBody = extractFunctionBody(normalShader, 'getTransitionAlpha');
    const externalBody = extractFunctionBody(externalShader, 'getTransitionAlpha');
    const normalUvBody = extractFunctionBody(
      normalShader,
      'getTransitionUv',
    );
    const externalUvBody = extractFunctionBody(
      externalShader,
      'getTransitionUv',
    );

    expect(extractTransitionTypes(normalBody)).toEqual(EXPECTED_COMPOSITOR_TRANSITION_TYPES);
    expect(extractTransitionTypes(externalBody)).toEqual(EXPECTED_COMPOSITOR_TRANSITION_TYPES);
    expect(normalizeWgsl(externalBody)).toBe(normalizeWgsl(normalBody));
    expect(extractTransitionTypes(normalUvBody)).toEqual(EXPECTED_COMPOSITOR_DISTORTION_TYPES);
    expect(extractTransitionTypes(externalUvBody)).toEqual(EXPECTED_COMPOSITOR_DISTORTION_TYPES);
    expect(normalizeWgsl(externalUvBody)).toBe(normalizeWgsl(normalUvBody));
    for (const field of ['sourceRectX', 'sourceRectY', 'sourceRectWidth', 'sourceRectHeight']) {
      expect(normalShader).toContain(field);
      expect(externalShader).toContain(field);
    }
  });

  it('encodes source rect metadata with full-source defaults', () => {
    const buffer = new ArrayBuffer(COMPOSITOR_UNIFORM_FLOAT_COUNT * 4);
    const floats = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);

    writeLayerUniformData(createLayer(), 1, 1, false, floats, u32);

    expect(floats[25]).toBe(0);
    expect(floats[26]).toBe(0);
    expect(floats[27]).toBe(1);
    expect(floats[28]).toBe(1);

    writeLayerUniformData(
      createLayer({
        sourceRect: {
          x: 0.25,
          y: 0.5,
          width: 0.125,
          height: 0.25,
        },
      }),
      1,
      1,
      false,
      floats,
      u32,
    );

    expect(floats[25]).toBeCloseTo(0.25);
    expect(floats[26]).toBeCloseTo(0.5);
    expect(floats[27]).toBeCloseTo(0.125);
    expect(floats[28]).toBeCloseTo(0.25);
  });

  it('encodes transition metadata into the reusable padding slots', () => {
    const buffer = new ArrayBuffer(COMPOSITOR_UNIFORM_FLOAT_COUNT * 4);
    const floats = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);

    const cases = [
      ['left', 1],
      ['right', 2],
      ['up', 3],
      ['down', 4],
    ] as const;

    for (const [direction, transitionType] of cases) {
      writeLayerUniformData(
        createLayer({
          transitionRender: {
            kind: 'wipe',
            direction,
            progress: 0.25,
          },
        }),
        1,
        1,
        false,
        floats,
        u32,
      );

      expect(u32[22]).toBe(transitionType);
      expect(floats[23]).toBeCloseTo(0.25);
      expect(floats[24]).toBe(0);
    }

    const maskCases = [
      [{ kind: 'shape-mask', shape: 'circle', progress: 0.5 }, 5],
      [{ kind: 'shape-mask', shape: 'diamond', progress: 0.5 }, 6],
      [{ kind: 'shape-mask', shape: 'rect', progress: 0.5 }, 7],
      [{ kind: 'shape-mask', shape: 'oval', progress: 0.5 }, 16],
      [{ kind: 'shape-mask', shape: 'triangle', progress: 0.5 }, 17],
      [{ kind: 'shape-mask', shape: 'cross', progress: 0.5 }, 18],
      [{ kind: 'shape-mask', shape: 'star', progress: 0.5 }, 19],
      [{ kind: 'clock-mask', clockwise: true, angleOffset: 0, progress: 0.5 }, 8],
      [{ kind: 'center-mask', axis: 'x', progress: 0.5 }, 9],
      [{ kind: 'center-mask', axis: 'y', progress: 0.5 }, 10],
      [{ kind: 'procedural-mask', procedural: 'noise', progress: 0.5, seed: 17 }, 11],
      [{ kind: 'procedural-mask', procedural: 'blocks', progress: 0.5, seed: 23 }, 12],
      [{ kind: 'pattern-mask', pattern: 'checker', progress: 0.5 }, 13],
      [{ kind: 'pattern-mask', pattern: 'venetian-horizontal', progress: 0.5 }, 14],
      [{ kind: 'pattern-mask', pattern: 'venetian-vertical', progress: 0.5 }, 15],
      [{ kind: 'pattern-mask', pattern: 'random-blocks', progress: 0.5 }, 20],
      [{ kind: 'pattern-mask', pattern: 'zig-zag', progress: 0.5 }, 21],
      [{ kind: 'pattern-mask', pattern: 'polka-dot', progress: 0.5 }, 22],
      [{ kind: 'pattern-mask', pattern: 'doom-bars', progress: 0.5 }, 23],
      [{ kind: 'pattern-mask', pattern: 'paint-splatter', progress: 0.5 }, 24],
      [{ kind: 'distortion', distortion: 'water-drop', progress: 0.5, seed: 31 }, 25],
      [{ kind: 'distortion', distortion: 'swirl', progress: 0.5, seed: 37 }, 26],
    ] as const;

    for (const [transitionRender, transitionType] of maskCases) {
      writeLayerUniformData(
        createLayer({ transitionRender }),
        1,
        1,
        false,
        floats,
        u32,
      );

      expect(u32[22]).toBe(transitionType);
      expect(floats[23]).toBeCloseTo(0.5);
      expect(floats[24]).toBe(
        transitionRender.kind === 'procedural-mask' || transitionRender.kind === 'distortion'
          ? transitionRender.seed
          : 0,
      );
    }

    writeLayerUniformData(createLayer(), 1, 1, false, floats, u32);

    expect(u32[22]).toBe(0);
    expect(floats[23]).toBe(0);
    expect(floats[24]).toBe(0);
  });
});
