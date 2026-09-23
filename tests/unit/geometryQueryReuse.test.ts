import { afterEach, expect, it, vi } from 'vitest';
import { GeometryQueryOutput } from '../../src/effects/time/slit-scan/GeometryQueryOutput';
import * as compiler from '../../src/services/operators/imageOperatorGraph';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { getDefaultParams } from '../../src/effects';
import type { SlitScanGeometryCapture } from '../../src/effects/time/slit-scan/geometryCapture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('rebinds changed query values, recompiles graph edits, and rejects invalid input', () => {
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2 });
  const effect = { id: 'surface', type: 'slit-scan', params: getDefaultParams('slit-scan') };
  const graph = effectOperatorGraph(effect);
  const encode = vi.fn(() => true);
  const frame = { effect, graph, source: {}, resources: new Map(), width: 32, height: 32,
    input: {}, encoder: {}, sampler: {}, resolveResources: () => true,
    passRuntime: { encode, release: vi.fn() },
    device: { createTexture: () => ({ width: 32, height: 32, createView: () => ({}) }) },
  } as unknown as SlitScanGeometryCapture;
  const compile = vi.spyOn(compiler, 'compileImageOperatorGraph');
  const query = new GeometryQueryOutput();
  query.capture(frame, 'history');
  const first = (encode.mock.calls as unknown as [{ plan: compiler.ImageOperatorPlan }][])[0][0].plan;
  expect(compile).toHaveBeenCalledTimes(1);
  const next = { ...frame, effect: { ...frame.effect, params: { ...frame.effect.params, angle: 60 } } };
  query.capture(next, 'history');
  const second = (encode.mock.calls as unknown as [{ plan: compiler.ImageOperatorPlan }][])[1][0].plan;
  expect(compile).toHaveBeenCalledTimes(1);
  expect(second.passes![0].program.instructions).toBe(first.passes![0].program.instructions);
  expect(second.passes![0].program.values).not.toEqual(first.passes![0].program.values);
  expect(() => query.capture({ ...next, effect: { ...next.effect, params: { ...next.effect.params, angle: NaN } } }, 'history')).toThrow(/finite/);
  query.capture({ ...next, graph: { ...graph, layout: { ...graph.layout, history: { x: 7, y: 9 } } } }, 'history');
  expect(compile).toHaveBeenCalledTimes(2);
});
