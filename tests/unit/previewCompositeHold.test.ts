import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '../../src/engine/core/types';
import type { RenderDeps } from '../../src/engine/render/RenderDispatcher';
import type { RenderOutputRouter } from '../../src/engine/render/contracts';
import type { RenderSurfaceFrameContext } from '../../src/services/render/renderHostTypes';
import { DispatcherTelemetry } from '../../src/engine/render/dispatcher/dispatcherTelemetry';
import { MISSING_RASTER_FOLLOW_UP_FRAMES, PreviewCompositeHold } from '../../src/engine/render/dispatcher/previewCompositeHold';

function context(time = 10, changes: Partial<RenderSurfaceFrameContext> = {}): RenderSurfaceFrameContext {
  return { compositionId: 'comp', timelineTimeSeconds: time,
    frameHistory: { eventRevision: 3, ownerRevision: 9 }, ...changes };
}

function video(changes: Partial<Layer> = {}): Layer {
  return { id: 'layer', sourceClipId: 'clip', visible: true, opacity: 1,
    source: { type: 'video', mediaFileId: 'mxf', runtimeSourceId: 'source', runtimeSessionKey: 'camera', mediaTime: 10 },
    ...changes } as Layer;
}

function text(clipId: string, canvas: HTMLCanvasElement): Layer {
  return { id: 'comp_layer_0', sourceClipId: clipId, visible: true, opacity: 1,
    source: { type: 'text', textCanvas: canvas } } as Layer;
}

function harness(layers = [video()], frameContext: RenderSurfaceFrameContext | undefined = context(), presentedComplete = true) {
  const submit = vi.fn();
  const device = { createCommandEncoder: () => ({ finish: () => ({}) }), queue: { submit } } as unknown as GPUDevice;
  const routeCompositeFrame = vi.fn();
  const router = { captureSnapshot: () => ({ activeCompositionTargetIds: ['preview'] }), routeCompositeFrame } as unknown as RenderOutputRouter;
  const telemetry = new DispatcherTelemetry();
  telemetry.lastPreviewTargetTimeMs = 10_000;
  telemetry.lastPreviewDisplayedTimeMs = 10_000;
  const record = vi.fn();
  const clear = vi.fn();
  const requestRender = vi.fn();
  const deps = { sampler: {}, exportCanvasManager: { shouldSkipPreviewOutput: () => false },
    performanceStats: { setLayerCount: vi.fn() }, renderLoop: { requestRender } } as unknown as RenderDeps;
  const hold = new PreviewCompositeHold(deps, router, telemetry, record);
  const view = {} as GPUTextureView;
  hold.recordComposite(view, layers, frameContext, presentedComplete);
  const input = { device, layers, frameContext: context(10.407), frameTimelineTime: 10.407,
    isPlaying: true, isExporting: false, isDragging: false, lastRenderHadContent: true,
    lastPreviewTimelineTimeSeconds: 10, renderEmptyFrame: clear };
  return { hold, input, view, record, clear, submit, routeCompositeFrame, requestRender };
}

describe('preview composite ownership during decoder stalls', () => {
  it('re-presents the last complete video composite after a 407ms playback tick', () => {
    const { hold, input, view, clear, submit, routeCompositeFrame, record } = harness();
    expect(hold.renderEmpty(input)).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    expect(routeCompositeFrame).toHaveBeenCalledWith(expect.objectContaining({ sourceView: view }));
    expect(submit).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith('playback-stall-hold', undefined,
      expect.objectContaining({ clipId: 'clip', displayedTimeMs: 10_000 }));
    expect(hold.renderEmpty({ ...input, frameContext: context(10.8), frameTimelineTime: 10.8,
      lastPreviewTimelineTimeSeconds: 10.407 })).toBe(true);
  });

  it.each(['seek', 'loop'] as const)('rejects a %s even when its target is only one frame away', discontinuity => {
    const { hold, input, clear, routeCompositeFrame } = harness();
    expect(hold.renderEmpty({ ...input, frameTimelineTime: 10.04,
      frameContext: context(10.04, { frameHistory: { eventRevision: 4, ownerRevision: 9, discontinuity } }) })).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
    expect(routeCompositeFrame).not.toHaveBeenCalled();
  });

  it.each([
    ['composition', context(10.04, { compositionId: 'other' })],
    ['timeline edit', context(10.04, { frameHistory: { eventRevision: 3, ownerRevision: 10 } })],
  ] as const)('rejects a changed %s', (_name, frameContext) => {
    const { hold, input } = harness();
    expect(hold.renderEmpty({ ...input, frameContext, frameTimelineTime: 10.04 })).toBe(false);
  });

  it.each([
    ['cut', video({ sourceClipId: 'next-clip' })],
    ['media', video({ source: { ...video().source!, mediaFileId: 'other' } })],
    ['runtime source', video({ source: { ...video().source!, runtimeSourceId: 'other' } })],
    ['runtime session', video({ source: { ...video().source!, runtimeSessionKey: 'other' } })],
    ['provider', video({ source: { ...video().source!, webCodecsPlayer: {} as NonNullable<Layer['source']>['webCodecsPlayer'] } })],
  ] as const)('rejects a changed %s instead of retaining the preceding picture', (_name, layer) => {
    const { hold, input, clear } = harness();
    expect(hold.renderEmpty({ ...input, layers: [layer], frameContext: context(10.04), frameTimelineTime: 10.04 })).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
  });

  it('snapshots source ownership instead of following a mutated layer object', () => {
    const layer = video();
    const { hold, input } = harness([layer]);
    layer.source!.runtimeSourceId = 'replacement';
    expect(hold.renderEmpty(input)).toBe(false);
  });

  it('ignores advancing media timestamps and changing decoded frame handles', () => {
    const { hold, input } = harness();
    const layer = video({ source: { ...video().source!, mediaTime: 10.407, videoFrame: {} as VideoFrame } });
    expect(hold.renderEmpty({ ...input, layers: [layer] })).toBe(true);
  });

  it.each([{ layers: [] }, { layers: [video({ visible: false })] }, { layers: [video({ opacity: 0 })] }])('clears a genuine gap or invisible input', ({ layers }) => {
    const { hold, input, clear, routeCompositeFrame } = harness();
    expect(hold.renderEmpty({ ...input, layers })).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
    expect(routeCompositeFrame).not.toHaveBeenCalled();
  });

  it('does not extend a reverse jump without a clock event', () => {
    const { hold, input } = harness();
    expect(hold.renderEmpty({ ...input, frameContext: context(9), frameTimelineTime: 9 })).toBe(false);
  });

  it('preserves the short-stall fallback when frame-history metadata is absent', () => {
    const { hold, input } = harness([video()], { compositionId: 'comp', timelineTimeSeconds: 10 });
    expect(hold.renderEmpty({ ...input, frameContext: undefined, frameTimelineTime: 10.04 })).toBe(true);
    expect(hold.renderEmpty({ ...input, frameContext: undefined })).toBe(false);
  });

  it('does not use an incomplete or export composite to extend the hold', () => {
    const { hold, input } = harness([video()], context(), false);
    expect(hold.renderEmpty(input)).toBe(false);
  });

  it.each([false, true])('never holds an export frame (dragging=%s)', isDragging => {
    const { hold, input, clear } = harness();
    expect(hold.renderEmpty({ ...input, isExporting: true, isDragging, frameTimelineTime: 10.04 })).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
  });

  it.each([
    video({ transitionRender: { kind: 'wipe', direction: 'left', progress: 0.5 } as Layer['transitionRender'] }),
    video({ source: { ...video().source!, nestedComposition: { compositionId: 'nested', layers: [], width: 1920, height: 1080 } } }),
  ])('keeps complex wrapper sources on the existing short hold', layer => {
    const { hold, input } = harness([layer]);
    expect(hold.renderEmpty(input)).toBe(false);
  });
});

describe('paused preview holds never stand in another clip', () => {
  const paused = { isPlaying: false, frameTimelineTime: 7, lastPreviewTimelineTimeSeconds: 2 };

  it('clears instead of re-presenting the previous text clip when a new clip raster is not ready', () => {
    const previous = text('clip-a', document.createElement('canvas'));
    const { hold, input, clear, routeCompositeFrame, record } = harness([previous], context(2));
    const next = text('clip-b', document.createElement('canvas'));
    expect(hold.renderEmpty({ ...input, ...paused, layers: [next], frameContext: context(7) })).toBe(false);
    expect(clear).toHaveBeenCalledOnce();
    expect(routeCompositeFrame).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith('empty', undefined, expect.objectContaining({ clipId: 'clip-b' }));
  });

  it('still bridges a not-yet-ready frame of the same clip', () => {
    const layer = text('clip-a', document.createElement('canvas'));
    const { hold, input, routeCompositeFrame } = harness([layer], context(2));
    expect(hold.renderEmpty({ ...input, ...paused, frameTimelineTime: 2.1, layers: [layer], frameContext: context(2.1) })).toBe(true);
    expect(routeCompositeFrame).toHaveBeenCalledOnce();
  });

  it('rejects a paused hold across compositions and after the held view was cleared', () => {
    const layer = text('clip-a', document.createElement('canvas'));
    const { hold, input } = harness([layer], context(2));
    expect(hold.showsSameSources([layer], context(2, { compositionId: 'other' }))).toBe(false);
    hold.clear();
    expect(hold.renderEmpty({ ...input, ...paused, layers: [layer], frameContext: context(2) })).toBe(false);
  });

  it('requests bounded follow-up frames for a raster that was not collected, then reports it once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const layer = text('clip-b', document.createElement('canvas'));
    const { hold, requestRender } = harness();
    for (let frame = 0; frame < MISSING_RASTER_FOLLOW_UP_FRAMES + 5; frame += 1) {
      hold.requestFrameForMissingRasters([layer], [], false);
    }
    expect(requestRender).toHaveBeenCalledTimes(MISSING_RASTER_FOLLOW_UP_FRAMES);
    hold.requestFrameForMissingRasters([layer], [{ layer }], false);
    hold.requestFrameForMissingRasters([layer], [], false);
    expect(requestRender).toHaveBeenCalledTimes(MISSING_RASTER_FOLLOW_UP_FRAMES + 1);
    warn.mockRestore();
  });

  it('adds no wake during playback or for collected and video sources', () => {
    const layer = text('clip-b', document.createElement('canvas'));
    const { hold, requestRender } = harness();
    hold.requestFrameForMissingRasters([layer], [], true);
    hold.requestFrameForMissingRasters([layer], [{ layer }], false);
    hold.requestFrameForMissingRasters([video()], [], false);
    expect(requestRender).not.toHaveBeenCalled();
  });
});
