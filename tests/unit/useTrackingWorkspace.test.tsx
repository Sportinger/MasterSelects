import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanarTrack, SurfaceQuad } from '../../src/types/planarTracking';
import type { TrackingAsset } from '../../src/types/trackingAsset';

const fakes = vi.hoisted(() => {
  const editorState = {
    assetId: null as string | null,
    clipId: null as string | null,
    trackId: null as string | null,
    view: 'video' as const,
    tool: 'inspect' as 'inspect' | 'surface' | 'occlusion' | 'place',
    draft: null as SurfaceQuad | null,
    active: false,
    message: '',
    setEditor: vi.fn((patch: Record<string, unknown>) => Object.assign(editorState, patch)),
  };
  return {
    timelineState: {} as Record<string, any>,
    mediaState: {files: []} as Record<string, any>,
    trackingState: {assets: []} as Record<string, any>,
    editorState,
    publishTrackingAsset: vi.fn(),
    trackSurface: vi.fn(),
    solveTerrain: vi.fn(),
    historyEndBatch: vi.fn(),
  };
});

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(
    (selector: (state: typeof fakes.timelineState) => unknown) => selector(fakes.timelineState),
    {getState: () => fakes.timelineState},
  ),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(
    (selector: (state: typeof fakes.mediaState) => unknown) => selector(fakes.mediaState),
    {getState: () => fakes.mediaState},
  ),
}));

vi.mock('../../src/stores/trackingStore', () => ({
  useTrackingStore: Object.assign(
    (selector: (state: typeof fakes.trackingState) => unknown) => selector(fakes.trackingState),
    {getState: () => fakes.trackingState},
  ),
}));

vi.mock('../../src/stores/trackingEditorStore', () => ({
  useTrackingEditorStore: Object.assign(
    () => fakes.editorState,
    {getState: () => fakes.editorState},
  ),
}));

vi.mock('../../src/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({
      startBatch: () => ({opened: true}),
      endBatch: fakes.historyEndBatch,
    }),
  },
}));

vi.mock('../../src/services/planarTracking/trackingAssets', () => ({
  publishTrackingAsset: fakes.publishTrackingAsset,
}));
vi.mock('../../src/services/planarTracking/surfaceEffects', () => ({
  surfaceSourceTime: (_clip: unknown, localTime: number) => localTime,
}));
vi.mock('../../src/services/planarTracking/trackSurface', () => ({trackSurface: fakes.trackSurface}));
vi.mock('../../src/services/planarTracking/solveTerrain', () => ({solveTerrain: fakes.solveTerrain}));

import {
  getTrackingWorkspaceBounds,
  useTrackingWorkspace,
} from '../../src/components/panels/properties/surfaceTracking/useTrackingWorkspace';

const quad: SurfaceQuad = [{x: .2, y: .2}, {x: .8, y: .2}, {x: .8, y: .8}, {x: .2, y: .8}];
const correctedQuad: SurfaceQuad = [{x: .25, y: .2}, {x: .75, y: .2}, {x: .8, y: .75}, {x: .2, y: .8}];

function makeTrack(id: string, samples: PlanarTrack['samples'] = []): PlanarTrack {
  return {
    id,
    name: id,
    sourceId: 'media-1',
    fps: 25,
    referenceTime: 2,
    referenceQuad: structuredClone(quad),
    samples,
    occlusions: [],
    enabled: true,
    color: '#50c8ff',
    opacity: 1,
    fill: 0,
    lineWidth: 2,
    inset: 0,
    shape: 'outline',
    visibleFrom: 0,
    visibleTo: 10,
    fade: 0,
  };
}

function makeAsset(track: PlanarTrack): TrackingAsset {
  return {
    id: `asset-${track.id}`,
    type: 'tracking',
    name: track.name,
    parentId: null,
    createdAt: 1,
    sourceMediaId: track.sourceId,
    track,
    revision: 1,
  };
}

function installSourceClip(tracks: PlanarTrack[] = []) {
  const clip = {
    id: 'clip-1',
    name: 'Source clip',
    trackId: 'video-1',
    startTime: 0,
    inPoint: 0,
    outPoint: 10,
    source: {type: 'video', mediaFileId: 'media-1'},
    planarTracks: tracks,
  };
  fakes.timelineState.clips = [clip];
  return clip;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fakes.editorState, {
    assetId: null,
    clipId: null,
    trackId: null,
    view: 'video',
    tool: 'inspect',
    draft: null,
    active: false,
    message: '',
  });
  Object.assign(fakes.timelineState, {
    clips: [],
    tracks: [{id: 'video-1', locked: false}],
    playheadPosition: 2,
    isExporting: false,
    getClipKeyframes: vi.fn(() => []),
    updateClip: vi.fn((clipId: string, patch: Record<string, unknown>) => {
      fakes.timelineState.clips = fakes.timelineState.clips.map((clip: Record<string, unknown>) => (
        clip.id === clipId ? {...clip, ...patch} : clip
      ));
    }),
    invalidateCache: vi.fn(),
  });
  fakes.mediaState.files = [{id: 'media-1', name: 'source.mp4', fps: 25, url: 'blob:source'}];
  fakes.trackingState.assets = [];
  fakes.trackingState.removeAsset = vi.fn();
  fakes.mediaState.compositions = [];
  fakes.publishTrackingAsset.mockImplementation((clipId: string, track: PlanarTrack) => ({
    ...makeAsset(track),
    sourceVideoClipId: clipId,
  }));
});

describe('useTrackingWorkspace', () => {
  it('derives asset-only bounds from exact sample or camera durations', () => {
    const sampleTrack = makeTrack('sample', [
      {time: 2, duration: .125, quad, confidence: 1},
      {time: 4, duration: .5, quad, confidence: 1},
    ]);
    expect(getTrackingWorkspaceBounds(sampleTrack, 25)).toEqual({from: 2, to: 4.5});

    const terrainTrack = makeTrack('terrain');
    terrainTrack.terrain = {
      version: 1,
      solver: 'browser-sfm',
      referenceTime: 1,
      intrinsics: {width: 100, height: 100, fx: 50, fy: 50, cx: 50, cy: 50},
      cameras: [
        {time: 1, duration: .04, rotation: [1,0,0,0,1,0,0,0,1], translation: [0,0,0], error: 0, observations: 8},
        {time: 3, duration: .2, rotation: [1,0,0,0,1,0,0,0,1], translation: [1,0,0], error: 0, observations: 8},
      ],
      vertices: [], triangles: [], sourceFrameCount: 2, sparsePointCount: 0, medianError: 0,
    };
    expect(getTrackingWorkspaceBounds(terrainTrack, 25)).toEqual({from: 1, to: 3.2});
  });

  it('creates and selects a result while allowing external selection to remain authoritative', () => {
    const clip = installSourceClip();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const {result, rerender} = renderHook(() => useTrackingWorkspace('clip-1'));

    act(() => result.current.create());
    const created = fakes.timelineState.clips[0].planarTracks[0] as PlanarTrack;
    rerender();

    expect(created.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.current.track?.id).toBe(created.id);
    expect(fakes.editorState.trackId).toBe(created.id);
    expect(fakes.publishTrackingAsset).toHaveBeenCalledWith(clip.id, created);

    const other = makeTrack('other');
    fakes.timelineState.clips[0].planarTracks = [created, other];
    act(() => fakes.editorState.setEditor({draft: correctedQuad}));
    act(() => result.current.select(other.id));
    rerender();
    expect(result.current.track?.id).toBe(other.id);
    expect(fakes.editorState.draft).toBeNull();

    act(() => fakes.editorState.setEditor({trackId: created.id}));
    rerender();
    expect(result.current.track?.id).toBe(created.id);
  });

  it('rejects an invalid run range before creating or tracking a result', async () => {
    installSourceClip();
    const {result} = renderHook(() => useTrackingWorkspace('clip-1'));
    await waitFor(() => expect(result.current.url).toBe('blob:source'));
    act(() => result.current.setRange({from: 4, to: 3}));

    await act(async () => result.current.run('surface'));

    expect(fakes.timelineState.updateClip).not.toHaveBeenCalled();
    expect(fakes.trackSurface).not.toHaveBeenCalled();
    expect(result.current.message).toBe('Stopped: Choose a range inside this clip that includes the playhead.');
  });

  it('publishes the exact samples from a successful tracking run', async () => {
    installSourceClip([makeTrack('track-a')]);
    const trackedSamples: PlanarTrack['samples'] = [
      {time: 2, duration: .125, quad, confidence: 1},
      {time: 3, duration: .08, quad: correctedQuad, confidence: .9},
    ];
    fakes.trackSurface.mockResolvedValue({samples: trackedSamples});
    const {result} = renderHook(() => useTrackingWorkspace('clip-1'));
    await waitFor(() => expect(result.current.url).toBe('blob:source'));

    await act(async () => result.current.run('surface'));

    const updated = fakes.timelineState.clips[0].planarTracks[0] as PlanarTrack;
    expect(updated.samples).toEqual(trackedSamples);
    expect(fakes.publishTrackingAsset).toHaveBeenLastCalledWith('clip-1', updated);
    expect(result.current.message).toBe('Complete: 2 frames tracked');
  });

  it('preserves existing reference frames beyond a prematurely stopped tracking pass', async () => {
    const oldSamples = [1, 2, 3, 4, 5].map(time => ({ time, duration: 1, quad, confidence: 1 }));
    installSourceClip([makeTrack('track-a', oldSamples)]);
    fakes.trackSurface.mockResolvedValue({ samples: [{ ...oldSamples[1], quad: correctedQuad }], stopped: 'Lost object' });
    const { result } = renderHook(() => useTrackingWorkspace('clip-1'));
    await waitFor(() => expect(result.current.url).toBe('blob:source'));
    await act(async () => result.current.run('surface'));
    const updated = fakes.timelineState.clips[0].planarTracks[0] as PlanarTrack;
    expect(updated.samples.map(sample => sample.time)).toEqual([1, 2, 3, 4, 5]);
    expect(updated.samples[1].quad).toEqual(correctedQuad);
    expect(updated.samples[4]).toEqual(oldSamples[4]);
    expect(result.current.message).toContain('Stopped:');
  });

  it('cancels an active run and keeps the previous result', async () => {
    installSourceClip([makeTrack('track-a')]);
    let runSignal: AbortSignal | undefined;
    fakes.trackSurface.mockImplementation(({signal}: {signal: AbortSignal}) => {
      runSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => (
        reject(new DOMException('Cancelled', 'AbortError'))
      ), {once: true}));
    });
    const {result} = renderHook(() => useTrackingWorkspace('clip-1'));
    await waitFor(() => expect(result.current.url).toBe('blob:source'));

    let operation!: Promise<void>;
    act(() => { operation = result.current.run('surface'); });
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => result.current.cancel());
    await act(async () => operation);

    expect(runSignal?.aborted).toBe(true);
    expect(result.current.message).toBe('Stopped by you. Previous result kept.');
    expect(fakes.timelineState.updateClip).not.toHaveBeenCalled();
  });

  it('preserves a decoded sample timestamp and duration when saving a correction', () => {
    const original = makeTrack('track-a', [{time: 2, duration: .125, quad, confidence: .8}]);
    installSourceClip([original]);
    fakes.timelineState.playheadPosition = 2.05;
    const {result, rerender} = renderHook(() => useTrackingWorkspace('clip-1'));
    act(() => fakes.editorState.setEditor({tool: 'surface', draft: correctedQuad}));
    rerender();

    act(() => result.current.saveCorrection());
    const updated = fakes.timelineState.clips[0].planarTracks[0] as PlanarTrack;
    const correction = updated.samples.find(sample => sample.manual);

    expect(correction).toMatchObject({time: 2, duration: .125, quad: correctedQuad, manual: true});
    expect(updated.referenceTime).toBe(2);
    expect(fakes.publishTrackingAsset).toHaveBeenCalledWith('clip-1', updated);
  });

  it('uses the clip-local track for publication and safely no-ops without a source clip', async () => {
    const localTrack = makeTrack('shared', [
      {time: 2, duration: .125, quad, confidence: 1},
      {time: 4, duration: .5, quad, confidence: 1},
    ]);
    installSourceClip([localTrack]);
    const storedAsset = makeAsset(structuredClone(localTrack));
    fakes.trackingState.assets = [storedAsset];
    const {result, unmount} = renderHook(() => useTrackingWorkspace('clip-1', storedAsset.id));

    expect(result.current.track).toBe(localTrack);
    result.current.publish();
    expect(fakes.publishTrackingAsset).toHaveBeenLastCalledWith('clip-1', localTrack);
    unmount();

    fakes.timelineState.clips = [];
    fakes.publishTrackingAsset.mockClear();
    const assetOnly = renderHook(() => useTrackingWorkspace(undefined, storedAsset.id));
    expect(assetOnly.result.current.from).toBe(2);
    expect(assetOnly.result.current.to).toBe(4.5);
    expect(assetOnly.result.current.publish()).toBe(storedAsset);
    await act(async () => assetOnly.result.current.run('surface'));
    act(() => assetOnly.result.current.cancel());
    expect(fakes.publishTrackingAsset).not.toHaveBeenCalled();
    expect(fakes.trackSurface).not.toHaveBeenCalled();
  });
});

it('deletes a clip result and its unused published asset in an undo batch',()=>{
  const track=makeTrack('delete-me');installSourceClip([track]);fakes.trackingState.assets=[makeAsset(track)];
  const {result}=renderHook(()=>useTrackingWorkspace('clip-1'));
  act(()=>result.current.remove(track.id));
  expect(fakes.timelineState.clips[0].planarTracks).toEqual([]);
  expect(fakes.trackingState.removeAsset).toHaveBeenCalledWith('asset-delete-me');
  expect(fakes.historyEndBatch).toHaveBeenCalled();
});
it('keeps a published result used by another composition and respects track locks',()=>{
  const track=makeTrack('shared');installSourceClip([track]);fakes.trackingState.assets=[makeAsset(track)];
  fakes.mediaState.compositions=[{id:'other',timelineData:{clips:[{id:'linked',trackingBinding:{assetId:'asset-shared'}}]}}];
  const {result,rerender}=renderHook(()=>useTrackingWorkspace('clip-1'));
  fakes.timelineState.tracks[0].locked=true;rerender();
  act(()=>result.current.remove(track.id));expect(fakes.timelineState.updateClip).not.toHaveBeenCalled();
  fakes.timelineState.tracks[0].locked=false;rerender();
  act(()=>result.current.remove(track.id));expect(fakes.timelineState.clips[0].planarTracks).toEqual([]);
  expect(fakes.trackingState.removeAsset).not.toHaveBeenCalled();
});
