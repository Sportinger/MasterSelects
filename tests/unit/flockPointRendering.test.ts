import { describe, expect, it } from 'vitest';
import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import { indexFlockKeyframes, resolveFlockRender } from '../../src/services/flock/compiler/flockParamEvaluation';
import { flockPointChildrenForViewport, flockPointUsesCompute, flockPointUsesTriangles, packBranch } from '../../src/engine/flock/gpu/flockRenderPacking';
import type { FlockParamValue } from '../../src/types/flock';

function points(params: Record<string, FlockParamValue> = {}) {
  const b = new FlockGraphBuilder();
  const emitter = b.add('flock.emitter', { count: 1048576 });
  const sim = b.add('flock.simulation');
  const render = b.add('flock.render-points', { children: 8, size: 3, sizeVariance: 0, shape: 'dot', ...params });
  const output = b.add('flock.output');
  b.connect(emitter, 'spawn', sim, 'spawn').connect(sim, 'particles', render, 'particles').connect(render, 'scene', output, 'scene');
  const compiled = compileFlockDefinition(b.build('point-render-test'));
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  return resolveFlockRender(compiled.program, 0, { keyframesByProperty: indexFlockKeyframes([]) }).branches[0];
}

describe('Flock point render quality', () => {
  it('uses compute only for opaque points fitting the bounded pixel kernel', () => {
    expect(flockPointUsesCompute(points({ blend: 'opaque', size: 2 }), 1080)).toBe(true);
    expect(flockPointUsesCompute(points({ blend: 'opaque', size: 2 }), 2160)).toBe(false);
    expect(flockPointUsesCompute(points({ blend: 'alpha', size: 1 }), 1080)).toBe(false);
    expect(flockPointUsesCompute(points({ blend: 'additive', size: 1 }), 1080)).toBe(false);
    expect(flockPointUsesCompute(points({ blend: 'opaque', size: 2, sizeVariance: 0.1 }), 1080)).toBe(false);
    expect(flockPointUsesCompute(points({ blend: 'opaque', size: 1, sizeMode: 'world' }), 1080)).toBe(false);
  });
  it('reduces eight children to three at 1080p and preserves eight at 4K', () => {
    const branch = points();
    expect(flockPointChildrenForViewport(branch, 1048576, 1920 * 1080)).toBe(3);
    expect(flockPointChildrenForViewport(branch, 1048576, 3840 * 2160)).toBe(8);
    expect(flockPointChildrenForViewport(branch, 1048576, 960 * 540)).toBe(1);
    expect(flockPointChildrenForViewport(points({ children: 3 }), 1048576, 3840 * 2160)).toBe(3);
  });

  it('chooses sprite geometry using physical diameter and variance', () => {
    expect(flockPointUsesTriangles(points(), 1080)).toBe(true);
    expect(flockPointUsesTriangles(points(), 2160)).toBe(false);
    expect(flockPointUsesTriangles(points({ sizeVariance: 1 }), 1080)).toBe(false);
    expect(flockPointUsesTriangles(points({ shape: 'square' }), 540)).toBe(false);
    expect(flockPointUsesTriangles(points({ sizeMode: 'world' }), 1080)).toBe(false);
  });

  it('keeps shadow coverage independent of preview LOD and matches the draw geometry flag', () => {
    const branch = points();
    const preview = new Float32Array(packBranch(branch, { pointChildren: 3, viewportHeight: 1080 }).data);
    const exported = new Float32Array(packBranch(branch, { pointChildren: 8, viewportHeight: 2160 }).data);
    expect(preview[42]).toBe(3);
    expect(exported[42]).toBe(8);
    expect(preview[45]).toBe(1);
    expect(exported[45]).toBe(0);
    expect(preview[46]).toBeCloseTo(Math.sqrt(8));
    expect(exported[46]).toBe(preview[46]);
  });
});

describe('Flock soft motion sprites', () => {
  it('keeps old presets unchanged and carries new keyframeable appearance values into the GPU contract', () => {
    const old = new Float32Array(packBranch(points(), {}).data);
    expect(Array.from(old.slice(47, 50))).toEqual([0, 0, 0]);
    const data = new Float32Array(packBranch(points({ shape: 'soft', softness: 1, opacityVariance: .8, shutterSeconds: .06 }), {}).data);
    expect(data[47]).toBe(1); expect(data[48]).toBeCloseTo(.8); expect(data[49]).toBeCloseTo(.06);
  });
  it('keeps expanded halos and motion streaks out of bounded compute kernels and triangle optimizations', () => {
    for (const change of [{ softness: 1 }, { opacityVariance: .8 }, { shutterSeconds: .1 }]) {
      const branch = points({ shape: 'soft', size: 1, blend: 'opaque', ...change });
      expect(flockPointUsesCompute(branch, 1080)).toBe(false);
      expect(flockPointUsesTriangles(branch, 1080)).toBe(false);
    }
  });
});
