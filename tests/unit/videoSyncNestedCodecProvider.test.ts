import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  provider: null as null | { seek: ReturnType<typeof vi.fn>; advanceToTime: ReturnType<typeof vi.fn> },
  ensure: vi.fn(async () => null),
  update: vi.fn(),
  preview: vi.fn((source: unknown, trackId: string, shared: boolean) => ({ ...(source as object), runtimeSessionKey: `preview:${trackId}:${shared}` })),
  scrub: vi.fn((source: unknown, trackId: string, shared: boolean) => ({ ...(source as object), runtimeSessionKey: `scrub:${trackId}:${shared}` })),
}));
vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  ensureRuntimeFrameProvider: runtime.ensure,
  getPreviewRuntimeSource: runtime.preview,
  getScrubRuntimeSource: runtime.scrub,
  getRuntimeFrameProvider: () => runtime.provider,
  isProviderBackedRuntimeSource: (source: { codec?: string } | null) => source?.codec === 'mxf',
  updateRuntimePlaybackTime: runtime.update,
}));

import { syncNestedCodecProviderClip } from '../../src/services/layerBuilder/videoSyncNestedCodecProvider';
import type { TimelineClip } from '../../src/types';

// An MXF piece inside a transition composition: comp 0–5 s shows source 512.655 onward.
const clip = { id: 'out', trackId: 'transition-comp-track:t:outgoing', startTime: 0, duration: 5, inPoint: 512.655, outPoint: 517.655, source: { type: 'video', codec: 'mxf' } } as unknown as TimelineClip;
const paused = { isPlaying: false, isDraggingPlayhead: false, hasClipDragPreview: false };

describe('codec-provider clips inside nested and transition compositions', () => {
  it('starts the decoder in the session the nested layer reads when none exists yet', () => {
    runtime.provider = null;
    expect(syncNestedCodecProviderClip({ nestedClip: clip, compositionTime: 1.685, compositionRate: 1, ctx: paused, shouldSeekPaused: () => true })).toBe(true);
    expect(runtime.ensure).toHaveBeenCalledWith(expect.objectContaining({ runtimeSessionKey: 'preview:transition-comp-track:t:outgoing:true' }), 'interactive', expect.closeTo(514.34, 3));
  });

  it('seeks the decoder to the clip time while paused and advances it during playback', () => {
    runtime.provider = { seek: vi.fn(), advanceToTime: vi.fn() };
    syncNestedCodecProviderClip({ nestedClip: clip, compositionTime: 1.685, compositionRate: 1, ctx: paused, shouldSeekPaused: () => true });
    expect(runtime.provider.seek).toHaveBeenCalledWith(expect.closeTo(514.34, 3));
    syncNestedCodecProviderClip({ nestedClip: clip, compositionTime: 2, compositionRate: 1, ctx: { ...paused, isPlaying: true }, shouldSeekPaused: () => true });
    expect(runtime.provider.advanceToTime).toHaveBeenCalledWith(expect.closeTo(514.655, 3));
  });

  it('leaves clips alone that are inactive, not codec-backed, or already on the frame', () => {
    runtime.provider = { seek: vi.fn(), advanceToTime: vi.fn() };
    expect(syncNestedCodecProviderClip({ nestedClip: clip, compositionTime: 6, compositionRate: 1, ctx: paused, shouldSeekPaused: () => true })).toBe(false);
    const html = { ...clip, source: { type: 'video' } } as unknown as TimelineClip;
    expect(syncNestedCodecProviderClip({ nestedClip: html, compositionTime: 1, compositionRate: 1, ctx: paused, shouldSeekPaused: () => true })).toBe(false);
    syncNestedCodecProviderClip({ nestedClip: clip, compositionTime: 1, compositionRate: 1, ctx: paused, shouldSeekPaused: () => false });
    expect(runtime.provider.seek).not.toHaveBeenCalled();
  });
});
