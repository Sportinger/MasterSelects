import { describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_GPU_FENCE_TIMEOUT_MS, PREVIEW_GPU_PAUSED_TARGET_LIMIT, getPreviewGpuBackpressureState,
  previewSubmissionPolicy, previewSubmissionTarget, renderWithPreviewBackpressure,
} from '../../src/engine/engineCore/previewGpuBackpressure';
import type { Layer } from '../../src/engine/core/types';

const layer = (id: string, sourceClipId?: string) => ({ id, sourceClipId }) as Layer;
const paused = (time: number, ...ids: string[]) => previewSubmissionPolicy(false, ids.map(id => layer(id, id)),
  { compositionId: 'comp', timelineTimeSeconds: time });

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

  it('shows a paused seek at once while two earlier submissions are still pending (late WebKit fences)', async () => {
    const g = gpu(), submitted: string[] = [];
    const wake = vi.fn(() => renderWithPreviewBackpressure(g.device, false, () => submitted.push('latest'), wake, paused(12, 'old', 'text')));
    // createTextClip: updateTextProperties renders directly, then the RenderLoop renders the store change.
    renderWithPreviewBackpressure(g.device, false, () => submitted.push('text render'), wake, previewSubmissionPolicy(false, [layer('old', 'old'), layer('text', 'text')]));
    renderWithPreviewBackpressure(g.device, false, () => submitted.push('store change'), wake, paused(0, 'old'));
    // setPlayhead(12) onto the new clip arrives before either fence settles.
    renderWithPreviewBackpressure(g.device, false, () => submitted.push('seek'), wake, paused(12, 'old', 'text'));
    expect(submitted).toEqual(['text render', 'store change', 'seek']);
    expect(getPreviewGpuBackpressureState(g.device)).toMatchObject({ inFlight: 3, pendingRequest: false });
    expect(wake).not.toHaveBeenCalled();
  });

  it('coalesces a paused request for a picture that is already in flight', async () => {
    const g = gpu(), submitted: string[] = [];
    const wake = vi.fn(() => renderWithPreviewBackpressure(g.device, false, () => submitted.push('latest'), wake, paused(4, 'a')));
    renderWithPreviewBackpressure(g.device, false, () => submitted.push('first'), wake, paused(4, 'a'));
    // A slider drag at the same time and layers re-renders the same target.
    for (let i = 0; i < 20; i++) renderWithPreviewBackpressure(g.device, false, () => submitted.push('drag'), wake, paused(4, 'a'));
    expect(submitted).toEqual(['first']);
    g.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(wake).toHaveBeenCalledTimes(1);
    expect(submitted).toEqual(['first', 'latest']);
  });

  it('keeps one submission in flight during playback and scrubbing, even after paused work', () => {
    const g = gpu(), render = vi.fn(), wake = vi.fn();
    renderWithPreviewBackpressure(g.device, false, render, wake, paused(1, 'a'));
    renderWithPreviewBackpressure(g.device, false, render, wake, previewSubmissionPolicy(true, [layer('a')]));
    renderWithPreviewBackpressure(g.device, false, render, wake);
    expect(render).toHaveBeenCalledTimes(1);
    expect(previewSubmissionPolicy(true, [layer('a')])).toEqual({ continuous: true });
  });

  it('keys paused targets by timeline time and layer identities', () => {
    const ctx = { compositionId: 'comp', timelineTimeSeconds: 2 };
    expect(previewSubmissionTarget([layer('a', 'c1')], ctx)).toBe(previewSubmissionTarget([layer('a', 'c1')], ctx));
    expect(previewSubmissionTarget([layer('a', 'c1')], ctx)).not.toBe(previewSubmissionTarget([layer('a', 'c2')], ctx));
    expect(previewSubmissionTarget([layer('a', 'c1')], ctx)).not.toBe(previewSubmissionTarget([layer('a', 'c1')], { ...ctx, timelineTimeSeconds: 3 }));
    expect(previewSubmissionTarget([layer('a', 'c1')])).not.toBe(previewSubmissionTarget([layer('a', 'c1')], ctx));
  });

  it('logs and defers paused targets once the safety bound is reached, then renders the newest', async () => {
    const g = gpu(), submitted: number[] = [];
    const wake = vi.fn(() => renderWithPreviewBackpressure(g.device, false, () => submitted.push(-1), wake, paused(99, 'a')));
    for (let t = 0; t <= PREVIEW_GPU_PAUSED_TARGET_LIMIT; t++) {
      renderWithPreviewBackpressure(g.device, false, () => submitted.push(t), wake, paused(t, 'a'));
    }
    expect(submitted).toHaveLength(PREVIEW_GPU_PAUSED_TARGET_LIMIT);
    expect(getPreviewGpuBackpressureState(g.device)?.pendingRequest).toBe(true);
    g.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(submitted.at(-1)).toBe(-1);
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
