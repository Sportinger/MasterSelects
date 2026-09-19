import { describe, expect, it } from 'vitest';

import { resolveNativeLiveInputPreviewId } from '../../src/components/preview/NativeLiveInputPreview';
import type { MediaFile } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const tracks: TimelineTrack[] = [
  { id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false },
  { id: 'video-2', name: 'Video 2', type: 'video', height: 70, muted: false, visible: true, solo: false },
];
const mediaFiles = [{
  id: 'camera-1',
  name: 'Camera',
  type: 'video',
  parentId: null,
  createdAt: 1,
  url: '',
  liveInput: { kind: 'video-device' },
}] as MediaFile[];

function liveClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Camera',
    file: new File([], 'live-input.dat'),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'video', liveInputId: 'camera-1' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

function resolve(clips: TimelineClip[], overrides: Partial<Parameters<typeof resolveNativeLiveInputPreviewId>[0]> = {}) {
  return resolveNativeLiveInputPreviewId({
    clipKeyframes: new Map(),
    clips,
    mediaFiles,
    playheadPosition: 1,
    tracks,
    ...overrides,
  });
}

describe('native live-input preview selection', () => {
  it('selects one plain visible camera input at the playhead', () => {
    expect(resolve([liveClip()])).toBe('camera-1');
  });

  it('keeps WebGPU for effects, transforms, keyframes, and 3D', () => {
    expect(resolve([liveClip({ effects: [{ id: 'fx' } as TimelineClip['effects'][number]] })])).toBeNull();
    expect(resolve([liveClip({
      transform: { ...structuredClone(DEFAULT_TRANSFORM), rotation: { x: 0, y: 0, z: 10 } },
    })])).toBeNull();
    expect(resolve([liveClip()], { clipKeyframes: new Map([['clip-1', [{}]]]) })).toBeNull();
    expect(resolve([liveClip({ is3D: true })])).toBeNull();
  });

  it('keeps WebGPU when more than one visible clip contributes', () => {
    expect(resolve([liveClip(), liveClip({ id: 'clip-2', trackId: 'video-2' })])).toBeNull();
  });

  it('ignores a non-rendering scene camera controller beside the 2D live input', () => {
    const cameraController = liveClip({
      id: 'camera-controller',
      trackId: 'video-2',
      source: { type: 'camera' },
    });
    expect(resolve([liveClip(), cameraController])).toBe('camera-1');
  });

  it('honors hidden and solo video tracks', () => {
    const hiddenTracks = tracks.map((track) => track.id === 'video-1' ? { ...track, visible: false } : track);
    expect(resolve([liveClip()], { tracks: hiddenTracks })).toBeNull();

    const soloTracks = tracks.map((track) => track.id === 'video-2' ? { ...track, solo: true } : track);
    expect(resolve([liveClip()], { tracks: soloTracks })).toBeNull();
  });

  it('rejects composition feedback to avoid bypassing feedback compositing', () => {
    const feedbackFiles = [{
      ...mediaFiles[0],
      liveInput: { kind: 'composition-feedback', compositionId: 'comp-1' },
    }] as MediaFile[];
    expect(resolve([liveClip()], { mediaFiles: feedbackFiles })).toBeNull();
  });
});
