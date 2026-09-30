import { describe, expect, it, vi } from 'vitest';
import { drawTimelineClipCanvasCompositionOutline } from '../../src/components/timeline/utils/timelineClipCanvasCompositionOutline';

function createContext() {
  return {
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), setLineDash: vi.fn(),
    lineDashOffset: 0,
  };
}

describe('viewport-bounded composition outlines', () => {
  it('does bounded work for a multi-hour clip without adding viewport edge borders', () => {
    const ctx = createContext();
    drawTimelineClipCanvasCompositionOutline({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      x: -490_000, top: 1, width: 507_000, height: 62,
      visibleLeft: 0, visibleRight: 4_000,
    });
    expect(ctx.moveTo.mock.calls).toEqual([[0, 2], [0, 62]]);
    expect(ctx.lineTo.mock.calls).toEqual([[4_000, 2], [4_000, 62]]);
    expect(ctx.arcTo).not.toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('preserves rounded corners at the real clip edges', () => {
    const ctx = createContext();
    drawTimelineClipCanvasCompositionOutline({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      x: 20, top: 1, width: 200, height: 62,
      visibleLeft: 0, visibleRight: 4_000,
    });
    expect(ctx.arcTo).toHaveBeenCalledTimes(4);
    expect(ctx.arcTo.mock.calls.map(([x]) => x)).toEqual([21, 21, 219, 219]);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('does not stroke a clip entirely outside the canvas', () => {
    const ctx = createContext();
    drawTimelineClipCanvasCompositionOutline({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      x: 5000, top: 1, width: 200, height: 62,
      visibleLeft: 0, visibleRight: 4_000,
    });
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
