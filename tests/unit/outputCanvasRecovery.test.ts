import { describe, expect, it, vi } from 'vitest';
import { restoreOutputCanvases } from '../../src/engine/engineCore/outputPresenter';

const update = vi.hoisted(() => vi.fn());
vi.mock('../../src/stores/renderTargetStore', () => ({
  useRenderTargetStore: { getState: () => ({ setTargetCanvas: update }) },
}));

describe('output canvas recovery', () => {
  it('rebinds preview and retained external outputs to their replacement contexts', () => {
    const preview = document.createElement('canvas');
    const output = document.createElement('canvas');
    const oldContext = {} as GPUCanvasContext;
    const previewContext = {} as GPUCanvasContext;
    const outputContext = {} as GPUCanvasContext;
    const targets = new Map([['external-output', { canvas: output, context: oldContext }]]);
    const configure = vi.fn((canvas: HTMLCanvasElement) => canvas === preview ? previewContext : outputContext);
    expect(restoreOutputCanvases(configure, preview, targets)).toBe(previewContext);
    expect(targets.get('external-output')).toEqual({ canvas: output, context: outputContext });
    expect(configure).toHaveBeenCalledWith(preview);
    expect(configure).toHaveBeenCalledWith(output);
    expect(update).toHaveBeenCalledWith('external-output', output, outputContext);
  });
});
