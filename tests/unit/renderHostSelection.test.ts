import { describe, expect, it } from 'vitest';

import { selectRenderHost } from '../../src/services/render/renderHostSelection';

describe('render host selection', () => {
  it('never selects main in strict mode, even when the worker is unavailable', () => {
    const worker = { id: 'worker' };
    const result = selectRenderHost({ mainFallback: { id: 'main' }, workerPrimary: worker,
      preferWorkerPrimary: true, workerPrimaryAvailable: false, allowMainFallback: false,
      workerPrimaryBlockers: ['WebGPU unavailable'] });
    expect(result.host).toBe(worker);
    expect(result.telemetry.workerPrimaryAvailable).toBe(false);
    expect(result.telemetry.blockers).toEqual(['WebGPU unavailable']);
  });
  it('fails closed if strict mode has no worker implementation', () => {
    expect(() => selectRenderHost({ mainFallback: {}, preferWorkerPrimary: true,
      allowMainFallback: false })).toThrow('main fallback is disabled');
  });
  it('does not let a stale preference override the fallback prohibition', () => {
    const worker = {};
    expect(selectRenderHost({ mainFallback: {}, workerPrimary: worker, preferWorkerPrimary: false,
      workerPrimaryAvailable: true, allowMainFallback: false }).host).toBe(worker);
  });
  it('keeps the main fallback when worker primary is not requested', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: false,
      workerPrimaryAvailable: true,
    });

    expect(selection.host).toBe(main);
    expect(selection.telemetry).toMatchObject({
      selectedId: 'main-fallback',
      selectedRole: 'fallback',
      workerPrimaryRequested: false,
      workerPrimaryRegistered: true,
      workerPrimaryAvailable: true,
    });
    expect(selection.telemetry.blockers).toContain('worker render host flag disabled');
  });

  it('does not report worker availability blockers while the worker flag is disabled', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: false,
      workerPrimaryAvailable: false,
    });

    expect(selection.host).toBe(main);
    expect(selection.telemetry.blockers).toEqual(['worker render host flag disabled']);
    expect(selection.telemetry.workerPrimaryRegistered).toBe(true);
    expect(selection.telemetry.workerPrimaryAvailable).toBe(false);
  });

  it('selects worker primary only when requested, registered, and available', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: true,
      workerPrimaryAvailable: true,
    });

    expect(selection.host).toBe(worker);
    expect(selection.telemetry).toEqual({
      selectedId: 'worker-primary',
      selectedRole: 'primary',
      workerPrimaryRequested: true,
      workerPrimaryRegistered: true,
      workerPrimaryAvailable: true,
      blockers: [],
      reason: 'using worker primary render host',
    });
  });

  it('reports why requested worker primary cannot mount yet', () => {
    const main = { id: 'main' };
    const worker = { id: 'worker' };

    const selection = selectRenderHost({
      mainFallback: main,
      workerPrimary: worker,
      preferWorkerPrimary: true,
      workerPrimaryAvailable: false,
      workerPrimaryBlockers: ['W5_VISIBLE_PRESENTATION_PROVEN:blocked'],
    });

    expect(selection.host).toBe(main);
    expect(selection.telemetry).toMatchObject({
      selectedId: 'main-fallback',
      workerPrimaryRequested: true,
      workerPrimaryRegistered: true,
      workerPrimaryAvailable: false,
      blockers: ['W5_VISIBLE_PRESENTATION_PROVEN:blocked'],
    });
  });
});
