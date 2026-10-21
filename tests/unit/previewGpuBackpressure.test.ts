import { describe, expect, it, vi } from 'vitest';
import { PREVIEW_GPU_FENCE_TIMEOUT_MS, renderWithPreviewBackpressure } from '../../src/engine/engineCore/previewGpuBackpressure';

function gpu() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const device = { queue: { onSubmittedWorkDone: vi.fn(() => pending) } } as unknown as GPUDevice;
  return { device, resolve, reject };
}

describe('preview GPU backpressure', () => {
  it('coalesces a scrub burst and requests fresh state after the last pointer event', async () => {
    const g = gpu(), submitted: number[] = [];
    let playhead = 0;
    const render = () => submitted.push(playhead);
    const wake = vi.fn(() => renderWithPreviewBackpressure(g.device, false, render, wake));
    renderWithPreviewBackpressure(g.device, false, render, wake);
    for (playhead = 1; playhead <= 90; playhead++) renderWithPreviewBackpressure(g.device, false, render, wake);
    playhead = 90;
    expect(submitted).toEqual([0]);
    g.resolve(); await Promise.resolve();
    expect(submitted).toEqual([0, 90]);
    expect(wake).toHaveBeenCalledTimes(1);
    await Promise.resolve(); expect(wake).toHaveBeenCalledTimes(1);
  });

  it('does not keep a paused scene rendering after its GPU work completes', async () => {
    const g = gpu(), wake = vi.fn();
    renderWithPreviewBackpressure(g.device, false, vi.fn(), wake);
    g.resolve(); await Promise.resolve(); expect(wake).not.toHaveBeenCalled();
  });

  it('preserves every exact export/RAM-preview frame while preview work is pending', () => {
    const g = gpu(), render = vi.fn(), wake = vi.fn();
    renderWithPreviewBackpressure(g.device, false, render, wake);
    for (let i = 0; i < 10; i++) renderWithPreviewBackpressure(g.device, true, render, wake);
    expect(render).toHaveBeenCalledTimes(11);
    expect(g.device.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1);
  });

  it('keeps a replacement GPU independent and does not wake a lost device', async () => {
    const a = gpu(), b = gpu(), render = vi.fn(), wake = vi.fn();
    renderWithPreviewBackpressure(a.device, false, render, wake);
    renderWithPreviewBackpressure(a.device, false, render, wake);
    renderWithPreviewBackpressure(b.device, false, render, wake);
    a.reject(new Error('device lost')); await Promise.resolve();
    b.resolve(); await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(2); expect(wake).not.toHaveBeenCalled();
  });

  it('tracks partially submitted GPU work even if rendering throws', async () => {
    const g = gpu(), render = vi.fn(), wake = vi.fn();
    expect(() => renderWithPreviewBackpressure(g.device, false, () => { throw Error('render failed'); }, wake)).toThrow('render failed');
    renderWithPreviewBackpressure(g.device, false, render, wake);
    expect(render).not.toHaveBeenCalled();
    g.resolve(); await Promise.resolve(); expect(wake).toHaveBeenCalledOnce();
  });

  it('reopens the preview when a GPU completion fence never settles', async () => {
    vi.useFakeTimers();
    try {
      const device = { queue: { onSubmittedWorkDone: vi.fn(() => new Promise<void>(() => {})) } } as unknown as GPUDevice;
      const submitted: string[] = [];
      const wake = vi.fn(() => renderWithPreviewBackpressure(device, false, () => submitted.push('latest'), wake));
      renderWithPreviewBackpressure(device, false, () => submitted.push('first'), wake);
      // A new text clip arrives while the first fence is still pending.
      renderWithPreviewBackpressure(device, false, () => submitted.push('text'), wake);
      expect(submitted).toEqual(['first']);
      await vi.advanceTimersByTimeAsync(PREVIEW_GPU_FENCE_TIMEOUT_MS - 1);
      expect(wake).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(wake).toHaveBeenCalledOnce();
      expect(submitted).toEqual(['first', 'latest']);
    } finally { vi.useRealTimers(); }
  });

  it('does not wake twice when a late fence settles after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const g = gpu(), wake = vi.fn();
      renderWithPreviewBackpressure(g.device, false, vi.fn(), wake);
      renderWithPreviewBackpressure(g.device, false, vi.fn(), wake);
      await vi.advanceTimersByTimeAsync(PREVIEW_GPU_FENCE_TIMEOUT_MS);
      g.resolve(); await Promise.resolve();
      expect(wake).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
