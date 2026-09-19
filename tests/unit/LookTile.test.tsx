import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/effects', () => ({ getEffect: () => ({ requiresContinuousRender: true }) }));

vi.mock('../../src/effects/looks/lookPreviewScheduler', () => ({
  lookPreviewScheduler: {
    cancel: vi.fn(),
    enqueue: vi.fn(),
  },
}));

vi.mock('../../src/effects/looks/lookThumbnailRuntime', () => ({
  lookThumbnailRuntime: {
    getCached: vi.fn(() => null),
    prewarm: vi.fn(async () => undefined),
    renderLook: vi.fn(async () => null),
  },
}));

import { lookPreviewScheduler } from '../../src/effects/looks/lookPreviewScheduler';
import { lookThumbnailRuntime } from '../../src/effects/looks/lookThumbnailRuntime';

import { LookTile } from '../../src/components/panels/looks/LookTile';

describe('LookTile thumbnail interaction', () => {
  it('applies the effect when its thumbnail is clicked', () => {
    const onApply = vi.fn();
    render(
      <LookTile
        look={{
          builtIn: true,
          category: 'digital',
          id: 'effect-preview-test',
          name: 'Test Effect',
          stack: [],
          tags: ['test'],
          thumbnail: { kind: 'generated' },
        }}
        onApply={onApply}
        sourceFrameId="frame-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply Test Effect from thumbnail' }));

    expect(onApply).toHaveBeenCalledOnce();
  });
});


describe('LookTile bitmap lifetime', () => {
  const look = { builtIn: true, category: 'digital' as const, id: 'lifetime', name: 'Lifetime', stack: [], tags: [], thumbnail: { kind: 'generated' as const } };
  let frames: FrameRequestCallback[];
  let drawImage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', undefined);
    frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    drawImage = vi.fn((bitmap: ImageBitmap) => {
      if (!bitmap.width) throw new DOMException('The image source is detached', 'InvalidStateError');
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
    vi.mocked(lookThumbnailRuntime.getCached).mockReturnValue(null);
    vi.mocked(lookThumbnailRuntime.renderLook).mockResolvedValue(null);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('reacquires an invalidated cached frame and schedules a replacement', () => {
    const bitmap = { width: 256, height: 144 } as ImageBitmap;
    vi.mocked(lookThumbnailRuntime.getCached).mockReturnValue(bitmap);
    const { container } = render(<LookTile look={look} sourceFrameId="a" onApply={() => {}} />);
    Object.assign(bitmap, { width: 0, height: 0 });
    vi.mocked(lookThumbnailRuntime.getCached).mockReturnValue(null);
    expect(() => act(() => frames.shift()!(0))).not.toThrow();
    expect(drawImage).not.toHaveBeenCalled();
    expect(container.querySelector('canvas')).not.toHaveClass('is-ready');
    expect(lookPreviewScheduler.enqueue).toHaveBeenCalled();
  });

  it('does not draw a completed job after its source changed', async () => {
    let complete!: (value: ImageBitmap) => void;
    vi.mocked(lookThumbnailRuntime.renderLook).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { rerender } = render(<LookTile look={look} sourceFrameId="a" onApply={() => {}} />);
    const job = vi.mocked(lookPreviewScheduler.enqueue).mock.calls[0][1];
    const pending = job();
    rerender(<LookTile look={look} sourceFrameId="b" onApply={() => {}} />);
    await act(async () => { complete({ width: 256, height: 144 } as ImageBitmap); await pending; });
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('closes but does not draw a hover frame completed after a source change', async () => {
    const animatedLook = { ...look, stack: [{ effectId: 'animated', enabled: true, params: {} }] };
    let complete!: (value: ImageBitmap) => void;
    vi.mocked(lookThumbnailRuntime.renderLook).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const { container, rerender } = render(<LookTile look={animatedLook} sourceFrameId="a" onApply={() => {}} />);
    fireEvent.pointerEnter(container.querySelector('article')!);
    act(() => frames.shift()!(performance.now() + 100));
    expect(lookThumbnailRuntime.renderLook).toHaveBeenCalledTimes(1);
    rerender(<LookTile look={animatedLook} sourceFrameId="b" onApply={() => {}} />);
    const bitmap = { width: 256, height: 144, close: vi.fn() } as unknown as ImageBitmap;
    await act(async () => { complete(bitmap); await Promise.resolve(); });
    expect(drawImage).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('bounds unavailable-frame retries', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<LookTile look={look} sourceFrameId="a" onApply={() => {}} />);
      for (let attempt = 0; attempt < 4; attempt++) {
        await act(async () => { await vi.mocked(lookPreviewScheduler.enqueue).mock.calls[attempt][1](); });
        act(() => vi.advanceTimersByTime(1000));
      }
      expect(lookPreviewScheduler.enqueue).toHaveBeenCalledTimes(4);
      unmount();
      act(() => vi.advanceTimersByTime(5000));
      expect(lookPreviewScheduler.enqueue).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });

  it('retries a closed render result without marking the tile ready', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(lookThumbnailRuntime.renderLook).mockResolvedValue({ width: 0, height: 0 } as ImageBitmap);
      const { container } = render(<LookTile look={look} sourceFrameId="a" onApply={() => {}} />);
      await act(async () => { await vi.mocked(lookPreviewScheduler.enqueue).mock.calls[0][1](); });
      expect(drawImage).not.toHaveBeenCalled();
      expect(container.querySelector('canvas')).not.toHaveClass('is-ready');
      act(() => vi.advanceTimersByTime(1000));
      expect(lookPreviewScheduler.enqueue).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
