import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Layer, LayerSource } from '../../src/types/layers';
import {
  createWorkerGpuNestedOccurrenceNamespace,
  validateWorkerGpuFrameStackContract,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackIdentity,
} from '../../src/services/render/workerGpuFrameStackContract';
import {
  WorkerGpuFrameStackHostProjectionError,
  buildWorkerGpuFrameStackProjectionRequest,
  type WorkerGpuFrameStackHostProjectionInput,
  type WorkerGpuFrameStackResolvedSource,
} from '../../src/services/render/workerGpuFrameStackHostProjection';
import { projectWorkerGpuFrameStack } from '../../src/services/render/workerGpuFrameStackProjector';

const NOW_MS = 1_500;
const frame: WorkerGpuFrameStackIdentity = {
  requestId: 'request:mixed-source', targetId: 'preview:mixed-source',
  compositionId: 'composition:root', timelineTime: 2, frameIndex: 12,
  intent: 'preview', submitByMs: 1_000, expireAfterMs: 2_000,
  graphVersion: 34, exact: true,
};

function layer(id: string, source: LayerSource, overrides: Partial<Layer> = {}): Layer {
  return {
    id: `runtime:${id}`, sourceClipId: `clip:${id}`, name: id, visible: true,
    opacity: 1, blendMode: 'normal', source, effects: [],
    position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, ...overrides,
  };
}

function adjustment(id = 'adjustment'): Layer {
  return layer(id, { type: 'motion-adjustment' }, {
    effects: [
      { id: `effect:${id}:brightness`, name: 'Brightness', type: 'brightness', enabled: true, params: { amount: 0.2 } },
      // The compatibility matrix keys this effect as 'gaussian-blur'; the
      // camelCase spelling is not in SUPPORTED_EFFECT_TYPE_SET and fails the freeze.
      { id: `effect:${id}:blur`, name: 'Gaussian Blur', type: 'gaussian-blur', enabled: true, params: { radius: 4 } },
    ],
  });
}

/**
 * Mirrors the text/solid/image branches of
 * `WorkerPresentingRenderHostPort.resolveGpuFrameStackSource`, including its
 * fallback of the target dimensions for a solid without intrinsic size. Tests
 * that omit a resolver would otherwise leave every non-video layer unresolved,
 * which fails the Adjustment freeze for reasons unrelated to what they assert.
 */
function defaultResolveSource(candidate: Layer): WorkerGpuFrameStackResolvedSource | null {
  const source = candidate.source;
  const clipId = candidate.sourceClipId ?? candidate.id;
  if (!source) return null;
  if (source.type === 'text' && source.textCanvas) {
    return {
      kind: 'bitmap', sourceId: `text:${clipId}`, runtimeSourceKind: 'text',
      source: source.textCanvas, width: source.textCanvas.width, height: source.textCanvas.height,
    };
  }
  if (source.type === 'solid' && typeof source.color === 'string') {
    return {
      kind: 'solid', sourceId: `solid:${clipId}`, runtimeSourceKind: 'solid',
      color: source.color, width: 320, height: 180,
    };
  }
  if (source.type === 'image' && source.imageElement) {
    return {
      kind: 'bitmap', sourceId: `image:${clipId}`, runtimeSourceKind: 'image',
      source: source.imageElement,
      width: source.imageElement.naturalWidth, height: source.imageElement.naturalHeight,
    };
  }
  return null;
}

function input(
  layers: readonly Layer[],
  resolveSource: WorkerGpuFrameStackHostProjectionInput['resolveSource'] = defaultResolveSource,
): WorkerGpuFrameStackHostProjectionInput {
  return {
    layers, width: 320, height: 180, frame, occurrenceNamespace: 'occurrence:root',
    intent: 'preview', surface: 'preview', nowMs: NOW_MS, resolveVideoSource: () => null, resolveSource,
  };
}

function admission(overrides: Partial<WorkerGpuFrameStackAdmission> = {}): WorkerGpuFrameStackAdmission {
  return {
    nowMs: NOW_MS, requestId: frame.requestId, targetId: frame.targetId,
    intent: frame.intent, graphVersion: frame.graphVersion, ...overrides,
  };
}

/**
 * The frame-stack contract validates payload bitmaps with `instanceof
 * ImageBitmap`, so a plain object literal is rejected as an invalid payload.
 * This mirrors the stub the other frame-stack suites use.
 */
class FakeImageBitmap {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  close(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ImageBitmap', FakeImageBitmap);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function snapshot(sourceWidth: number, sourceHeight: number) {
  return {
    bitmap: new FakeImageBitmap(sourceWidth, sourceHeight) as unknown as ImageBitmap,
    width: sourceWidth,
    height: sourceHeight,
  };
}

describe('MD7 mixed-source Worker GPU frame stack', () => {
  it('composites a title above the adjustment after lower color and blur processing', async () => {
    const title = layer('title', { type: 'text', textCanvas: { width: 200, height: 40 } as HTMLCanvasElement });
    const lower = layer('lower-solid', { type: 'solid', color: '#204060' });
    // Spy on the shared resolver so ordering assertions still see a resolved
    // lower solid; a stub that returned null for it would fail the Adjustment
    // freeze before any ordering could be observed.
    const resolveSource = vi.fn(defaultResolveSource);
    const projected = await projectWorkerGpuFrameStack({
      ...buildWorkerGpuFrameStackProjectionRequest(input([title, adjustment(), lower], resolveSource)),
      clock: () => NOW_MS,
      snapshotBitmap: async ({ sourceWidth, sourceHeight }) => snapshot(sourceWidth, sourceHeight),
    });

    expect(projected.execution.kind).toBe('frozen-adjustment');
    if (projected.execution.kind !== 'frozen-adjustment') throw new Error('Expected frozen plan');
    const passes = projected.execution.plan.passes.map((pass) => (
      'layerId' in pass ? `${pass.kind}:${pass.layerId}` : pass.kind
    ));
    const lowerResolve = passes.indexOf('resolve-source:clip:lower-solid');
    const mix = passes.indexOf('mix-adjustment-result:clip:adjustment');
    expect(lowerResolve).toBeLessThan(mix);
    expect(passes).toContain('apply-adjustment-effect:clip:adjustment');
    expect(passes.indexOf('resolve-source:clip:title')).toBeGreaterThan(mix);
    expect(passes.indexOf('composite-source:clip:title')).toBeGreaterThan(mix);
    expect(resolveSource).toHaveBeenCalledWith(title);
  });

  it('keeps a nested adjustment in its own occurrence namespace and frozen plan', async () => {
    const nested = layer('nested', {
      type: 'image',
      nestedComposition: {
        compositionId: 'composition:child',
        layers: [adjustment('child-adjustment'), layer('child-solid', { type: 'solid', color: '#112233' })],
        width: 160, height: 90, currentTime: 0.5,
      },
    });
    const projected = await projectWorkerGpuFrameStack({
      ...buildWorkerGpuFrameStackProjectionRequest(input([adjustment(), nested])), clock: () => NOW_MS,
    });
    const payload = projected.bindings[0]?.payload;
    expect(payload?.kind).toBe('nested-stack');
    if (!payload || payload.kind !== 'nested-stack') throw new Error('Expected nested stack');
    expect(payload.stack.execution.kind).toBe('frozen-adjustment');
    expect(payload.stack.occurrenceNamespace).toBe(
      createWorkerGpuNestedOccurrenceNamespace('occurrence:root', 'clip:nested'),
    );
    expect(payload.stack.frame.compositionId).toBe('composition:child');
  });

  it('rejects an unrepresentable source instead of omitting it', () => {
    expect(() => buildWorkerGpuFrameStackProjectionRequest(input([
      adjustment(), layer('camera', { type: 'camera' }),
    ]))).toThrowError(WorkerGpuFrameStackHostProjectionError);
  });

  it('keeps stale, wrong-composition, and wrong-frame mixed packets outside the boundary', async () => {
    const stack = await projectWorkerGpuFrameStack({
      ...buildWorkerGpuFrameStackProjectionRequest(input([
        layer('title', { type: 'text', textCanvas: { width: 100, height: 20 } as HTMLCanvasElement }),
        adjustment(), layer('lower-solid', { type: 'solid', color: '#000000' }),
      ])),
      clock: () => NOW_MS,
      snapshotBitmap: async ({ sourceWidth, sourceHeight }) => snapshot(sourceWidth, sourceHeight),
    });
    expect(validateWorkerGpuFrameStackContract(stack, admission()).ok).toBe(true);
    expect(validateWorkerGpuFrameStackContract(stack, admission({ nowMs: frame.expireAfterMs })).ok).toBe(false);
    expect(validateWorkerGpuFrameStackContract({
      ...stack, frame: { ...stack.frame, compositionId: 'composition:wrong' },
    }, admission()).ok).toBe(false);
    expect(validateWorkerGpuFrameStackContract({
      ...stack, frame: { ...stack.frame, frameIndex: stack.frame.frameIndex + 1 },
    }, admission()).ok).toBe(false);
  });
});