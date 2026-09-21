import { describe, expect, it } from 'vitest';
import { createWorkerSoftwareFeedbackStore, type WorkerSoftwareFeedbackFrameMetadata } from '../../src/services/render/workerSoftwareFeedbackEffects';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import type { Layer } from '../../src/types/layers';

const pixels = (value: number) => new Uint8ClampedArray([value, value, value, 255]);
const frame = (timelineTimeSeconds: number, extra: Partial<WorkerSoftwareFeedbackFrameMetadata> = {}): WorkerSoftwareFeedbackFrameMetadata => ({
  timelineTimeSeconds, ownerRevision: 1, compositionId: 'comp-a', ...extra,
});

describe('worker software feedback history', () => {
  it('carries canonical per-effect loop policy and defaults legacy values to reset', () => {
    const layer = (historyLoop?: unknown): Layer => ({
      id: 'layer', name: 'Layer', visible: true, opacity: 1, blendMode: 'normal' as const,
      source: { type: 'solid' }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
      effects: [{ id: 'water', name: 'Water', type: 'acuarela', enabled: true, params: { historyLoop } }],
    });
    expect(workerSoftwareEffectPlanForLayer(layer('continuous'))?.pixelEffects.acuarelaAdjustments?.[0]?.historyLoop).toBe('continuous');
    expect(workerSoftwareEffectPlanForLayer(layer('invalid'))?.pixelEffects.acuarelaAdjustments?.[0]?.historyLoop).toBe('reset');
  });

  it('holds committed pixels and promotes only the latest current output on advance', () => {
    const store = createWorkerSoftwareFeedbackStore();
    const input = { scopeId: 'preview', feedbackKey: 'effect', width: 1, height: 1, reset: false };
    expect(store.read({ ...input, frame: frame(0) })).toBeNull();
    store.write({ ...input, frame: frame(0), pixels: pixels(10) });

    expect(store.read({ ...input, frame: frame(1) })).toEqual(pixels(10));
    store.write({ ...input, frame: frame(1), pixels: pixels(20) });
    expect(store.read({ ...input, frame: frame(1) })).toEqual(pixels(10));
    store.write({ ...input, frame: frame(1), pixels: pixels(30) });
    expect(store.read({ ...input, frame: frame(2) })).toEqual(pixels(30));
  });

  it('clears on seek, explicit reset, owner change, and isolates composition scopes', () => {
    const store = createWorkerSoftwareFeedbackStore();
    const input = { scopeId: 'preview', feedbackKey: 'effect', width: 1, height: 1, reset: false };
    store.read({ ...input, frame: frame(0) });
    store.write({ ...input, frame: frame(0), pixels: pixels(10) });
    expect(store.read({ ...input, frame: frame(1) })).toEqual(pixels(10));
    expect(store.read({ ...input, frame: frame(2, { eventRevision: 1, discontinuity: 'seek' }) })).toBeNull();
    store.write({ ...input, frame: frame(2), pixels: pixels(20) });
    expect(store.read({ ...input, reset: true, frame: frame(3) })).toBeNull();
    store.write({ ...input, reset: true, frame: frame(3), pixels: pixels(30) });
    expect(store.read({ ...input, reset: true, frame: frame(4, { ownerRevision: 2 }) })).toBeNull();
    expect(store.read({ ...input, frame: frame(4, { compositionId: 'comp-b' }) })).toBeNull();
  });

  it('continues across loop wraps once and holds repeated loop events per isolated owner', () => {
    const store = createWorkerSoftwareFeedbackStore();
    const base = { scopeId: 'preview', feedbackKey: 'effect-a', width: 1, height: 1, reset: false, loopPolicy: 'continuous' as const };
    store.read({ ...base, frame: frame(4) });
    store.write({ ...base, frame: frame(4), pixels: pixels(10) });
    expect(store.read({ ...base, frame: frame(0, { eventRevision: 7, discontinuity: 'loop' }) })).toEqual(pixels(10));
    store.write({ ...base, frame: frame(0), pixels: pixels(20) });
    expect(store.read({ ...base, frame: frame(0, { eventRevision: 7, discontinuity: 'loop' }) })).toEqual(pixels(10));

    const resetOwner = { ...base, feedbackKey: 'effect-b', loopPolicy: 'reset' as const };
    store.read({ ...resetOwner, frame: frame(4) });
    store.write({ ...resetOwner, frame: frame(4), pixels: pixels(30) });
    expect(store.read({ ...resetOwner, frame: frame(0, { eventRevision: 7, discontinuity: 'loop' }) })).toBeNull();
  });
});
