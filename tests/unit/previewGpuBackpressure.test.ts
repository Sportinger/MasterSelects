import { describe, expect, it, vi } from 'vitest';
import { renderWithPreviewBackpressure } from '../../src/engine/engineCore/previewGpuBackpressure';

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
});
