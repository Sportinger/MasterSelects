import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';

const state = vi.hoisted(() => ({
  timeline: {
    isPlaying: true,
    isDraggingPlayhead: false,
    clipDragPreview: null as unknown,
    playbackWarmup: null as unknown,
    isExporting: false,
    isRamPreviewing: false,
    playbackSpeed: 1,
    playheadPosition: 1,
    clips: [] as TimelineClip[],
  },
  media: {
    activeCompositionId: 'program',
    compositions: [{
      id: 'program', frameRate: 25,
      multicam: {
        active: true,
        angles: [
          { trackId: 'camera-a', sources: [{ mediaFileId: 'a' }] },
          { trackId: 'camera-b', sources: [{ mediaFileId: 'b' }] },
        ],
      },
    }],
  },
  clock: 1,
  requestRender: vi.fn(),
  requestNewFrameRender: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => state.timeline } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => state.media } }));
vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({ getPlayheadPosition: () => state.clock }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ warn: state.warn }) } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: {
  requestRender: state.requestRender,
  requestNewFrameRender: state.requestNewFrameRender,
} }));

import {
  createCodecProviderRenderCallbacks,
  runtimeProviderRenderCallbacks,
} from '../../src/services/mediaRuntime/runtimeProviderRenderWake';

function programClip(mediaFileId: string, startTime: number, duration: number): TimelineClip {
  return {
    id: `clip-${mediaFileId}`,
    trackId: `camera-${mediaFileId}`,
    startTime,
    duration,
    source: { type: 'video', mediaFileId, runtimeSourceId: `media:${mediaFileId}` },
  } as TimelineClip;
}

function callbacks(mediaFileId = 'b') {
  return createCodecProviderRenderCallbacks({
    sourceId: `media:${mediaFileId}`,
    sessionKey: `interactive-track:camera-${mediaFileId}:media:${mediaFileId}`,
    mediaFileId,
    policy: 'interactive',
  }, 'MXF', {});
}

describe('runtime provider render wakes during multicam playback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(state.timeline, {
      isPlaying: true, isDraggingPlayhead: false, clipDragPreview: null,
      playbackWarmup: null, isExporting: false, isRamPreviewing: false,
      playbackSpeed: 1, playheadPosition: 1,
      clips: [programClip('a', 0, 5), programClip('b', 5, 5)],
    });
    state.media.activeCompositionId = 'program';
    state.media.compositions[0].multicam.active = true;
    state.clock = 1;
  });

  it('lets off-air frames update at normal cadence without forcing repeated main composites', () => {
    const angle = callbacks();
    for (let index = 0; index < 10; index++) angle.onFrame();
    expect(state.requestRender).toHaveBeenCalledTimes(10);
    expect(state.requestNewFrameRender).not.toHaveBeenCalled();
  });

  it('preserves every fresh program frame, including late frame corrections', () => {
    const program = callbacks('a');
    program.onFrame();
    program.onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledTimes(2);
    expect(state.requestRender).not.toHaveBeenCalled();
  });

  it('transfers immediate wakes at a cut using the live clock without recreating the provider', () => {
    const angle = callbacks();
    angle.onFrame();
    state.clock = 5; // The store still reports 1 second.
    angle.onFrame();
    expect(state.requestRender).toHaveBeenCalledTimes(1);
    expect(state.requestNewFrameRender).toHaveBeenCalledTimes(1);
  });

  it.each([4.98, 5.02])('retains both cut-adjacent angles at time %s', (time) => {
    state.clock = time;
    callbacks('a').onFrame();
    callbacks('b').onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledTimes(2);
  });

  it('reads camera edits made by the frame callback before deciding the wake', () => {
    const angle = createCodecProviderRenderCallbacks({
      sourceId: 'media:b', sessionKey: 'interactive-track:camera-b:media:b',
      mediaFileId: 'b', policy: 'interactive',
    }, 'MXF', { onFrame: () => { state.timeline.clips = [programClip('b', 0, 10)]; } });
    angle.onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
  });

  it('keeps the source immediate when another program track uses it', () => {
    const clip = programClip('b', 0, 10);
    clip.trackId = 'overlay';
    state.timeline.clips.push(clip);
    callbacks().onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
  });

  it.each([
    ['paused', { isPlaying: false }],
    ['scrubbing', { isDraggingPlayhead: true }],
    ['clip drag', { clipDragPreview: {} }],
    ['warmup', { playbackWarmup: {} }],
    ['export', { isExporting: true }],
    ['RAM preview', { isRamPreviewing: true }],
    ['reverse', { playbackSpeed: -1 }],
  ])('preserves immediate wakes for %s', (_name, change) => {
    Object.assign(state.timeline, change);
    callbacks().onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
  });

  it.each([
    { isComposition: true },
    { nestedClips: [{}] },
    { transitionIn: {} },
    { transitionOut: {} },
    { transitionRender: {} },
    { source: null },
  ])('preserves immediate wakes when program ownership is uncertain: %j', (change) => {
    Object.assign(state.timeline.clips[0], change);
    callbacks().onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
  });

  it.each(['interactive-scrub:camera-b:media:b', 'interactive-track:parent:camera-b:media:b'])
    ('does not throttle an unrelated or nested session: %s', (sessionKey) => {
      createCodecProviderRenderCallbacks({
        sourceId: 'media:b', sessionKey, mediaFileId: 'b', policy: 'interactive',
      }, 'MXF', {}).onFrame();
      expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
    });

  it('restores ordinary wakes when multicam mode is disabled', () => {
    const angle = callbacks();
    state.media.compositions[0].multicam.active = false;
    angle.onFrame();
    expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
  });

  it('preserves provider error reporting and the render retry', () => {
    const onError = vi.fn();
    const failure = new Error('decode failed');
    const angle = createCodecProviderRenderCallbacks({
      sourceId: 'media:b', sessionKey: 'interactive-track:camera-b:media:b',
      mediaFileId: 'b', policy: 'interactive',
    }, 'MXF', { onError });
    angle.onError(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(state.warn).toHaveBeenCalledWith('MXF provider error', {
      sourceId: 'media:b', message: 'decode failed',
    });
    expect(state.requestRender).toHaveBeenCalledOnce();
  });

  it('leaves ordinary WebCodecs provider callbacks unchanged', () => {
    runtimeProviderRenderCallbacks.onFrame();
    runtimeProviderRenderCallbacks.onError();
    expect(state.requestNewFrameRender).toHaveBeenCalledOnce();
    expect(state.requestRender).toHaveBeenCalledOnce();
  });
});
