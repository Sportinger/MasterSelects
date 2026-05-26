import { beforeEach, describe, expect, it } from 'vitest';
import {
  initHistoryStoreRefs,
  useHistoryStore,
} from '../../src/stores/historyStore';
import type {
  ClipAudioState,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../src/types';
import { createMockClip } from '../helpers/mockData';

type HistoryStoreRefs = Parameters<typeof initHistoryStoreRefs>[0];
type TimelineMockState = ReturnType<HistoryStoreRefs['timeline']['getState']>;
type MediaMockState = ReturnType<HistoryStoreRefs['media']['getState']>;
type DockMockState = ReturnType<HistoryStoreRefs['dock']['getState']>;

type PayloadProbe = {
  rawSamples?: Float32Array | number[];
  payloadBytes?: Uint8Array;
  renderedBuffer?: number[];
  sampleData?: number[];
  audioBuffer?: Float32Array;
  rawBytes?: Uint8Array;
};

function mockTrack(overrides: Partial<TimelineTrack>): TimelineTrack {
  return {
    id: overrides.id ?? 'a1',
    name: overrides.name ?? 'Audio 1',
    type: overrides.type ?? 'audio',
    height: overrides.height ?? 60,
    muted: overrides.muted ?? false,
    visible: overrides.visible ?? true,
    solo: overrides.solo ?? false,
    ...overrides,
  };
}

function mockMediaFile(overrides: Partial<MediaMockState['files'][number]>): MediaMockState['files'][number] {
  return {
    id: overrides.id ?? 'media-1',
    name: overrides.name ?? 'audio.wav',
    type: overrides.type ?? 'audio',
    parentId: null,
    createdAt: 0,
    url: '',
    ...overrides,
  };
}

function createMockStores() {
  let timelineState: TimelineMockState = {
    clips: [],
    tracks: [mockTrack({ id: 'a1' })],
    selectedClipIds: new Set<string>(),
    zoom: 50,
    scrollX: 0,
    layers: [],
    selectedLayerId: null,
    clipKeyframes: new Map(),
    markers: [],
  };

  let mediaState: MediaMockState = {
    files: [],
    compositions: [],
    folders: [],
    selectedIds: [],
    expandedFolderIds: [],
    textItems: [],
    solidItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    signalArtifacts: [],
    signalGraphs: [],
    signalOperators: [],
  };

  let dockState: DockMockState = { layout: null };

  return {
    timeline: {
      getState: () => timelineState,
      setState: (state: Partial<TimelineMockState>) => {
        timelineState = { ...timelineState, ...state };
      },
    },
    media: {
      getState: () => mediaState,
      setState: (state: Partial<MediaMockState>) => {
        mediaState = { ...mediaState, ...state };
      },
    },
    dock: {
      getState: () => dockState,
      setState: (state: Partial<DockMockState>) => {
        dockState = { ...dockState, ...state };
      },
    },
    setTimelineState: (state: Partial<TimelineMockState>) => {
      timelineState = { ...timelineState, ...state };
    },
    setMediaState: (state: Partial<MediaMockState>) => {
      mediaState = { ...mediaState, ...state };
    },
  };
}

function expectNoAudioPayloadFields(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('rawSamples');
  expect(serialized).not.toContain('payloadBytes');
  expect(serialized).not.toContain('renderedBuffer');
  expect(serialized).not.toContain('sampleData');
  expect(serialized).not.toContain('audioBuffer');
  expect(serialized).not.toContain('rawBytes');
}

describe('audio history snapshots', () => {
  let mocks: ReturnType<typeof createMockStores>;

  beforeEach(() => {
    useHistoryStore.setState({
      undoStack: [],
      redoStack: [],
      currentSnapshot: null,
      isApplying: false,
      batchId: null,
      batchLabel: null,
      maxHistorySize: 50,
    });

    mocks = createMockStores();
    initHistoryStoreRefs(mocks);
  });

  it('captures clip, track, master, and media audio refs as cloned JSON-safe state', () => {
    const clipAudioState = {
      sourceAudioRevisionId: 'rev-1',
      muted: false,
      sourceAnalysisRefs: {
        waveformPyramidId: 'waveform-source-1',
        spectrogramTileSetIds: ['spectrogram-source-1'],
        rawBytes: new Uint8Array([1, 2, 3]),
      } as MediaFileAudioAnalysisRefs & PayloadProbe,
      processedAnalysisRefs: {
        processedWaveformPyramidId: 'waveform-processed-1',
        loudnessEnvelopeId: 'loudness-1',
      },
      editStack: [{
        id: 'edit-1',
        type: 'trim',
        enabled: true,
        params: { snapToZeroCrossing: true },
        timeRange: { start: 0.1, end: 3.5 },
        createdAt: 10,
      }],
      rawSamples: new Float32Array([0.1, 0.2, 0.3]),
      payloadBytes: new Uint8Array([4, 5, 6]),
    } as ClipAudioState & PayloadProbe;

    const trackAudioState = {
      volumeDb: -6,
      pan: 0.25,
      muted: false,
      solo: false,
      recordArm: true,
      inputMonitor: false,
      meterMode: 'lufs',
      sends: [{ id: 'send-1', targetBusId: 'bus-reverb', gainDb: -12, preFader: false, enabled: true }],
      effectStack: [{
        id: 'track-fx-1',
        descriptorId: 'eq',
        enabled: true,
        params: { gainDb: -2 },
        sampleData: [1, 2, 3],
      } as NonNullable<TrackAudioState['effectStack']>[number] & PayloadProbe],
      renderedBuffer: [0, 1, 2],
    } as TrackAudioState & PayloadProbe;

    const masterAudioState = {
      volumeDb: -1,
      limiterEnabled: true,
      targetLufs: -14,
      truePeakCeilingDb: -1,
      effectStack: [{
        id: 'master-fx-1',
        descriptorId: 'limiter',
        enabled: true,
        params: { ceilingDb: -1 },
        audioBuffer: new Float32Array([0.4, 0.5]),
      } as NonNullable<MasterAudioState['effectStack']>[number] & PayloadProbe],
      exportPreflight: {
        lastCheckedAt: 20,
        warnings: [{ code: 'peak', message: 'near ceiling', severity: 'warning' }],
      },
    };

    const mediaAudioAnalysisRefs = {
      waveformPyramidId: 'media-waveform-1',
      spectrogramTileSetIds: ['media-spectrogram-1'],
      loudnessEnvelopeId: 'media-loudness-1',
      rawBytes: new Uint8Array([7, 8, 9]),
    } as MediaFileAudioAnalysisRefs & PayloadProbe;

    const clip = createMockClip({
      id: 'clip-audio-1',
      trackId: 'a1',
      source: null,
      audioState: clipAudioState,
    }) as TimelineClip;

    mocks.setTimelineState({
      clips: [clip],
      tracks: [mockTrack({ id: 'a1', audioState: trackAudioState })],
      masterAudioState,
    });
    mocks.setMediaState({
      files: [mockMediaFile({ id: 'media-1', audioAnalysisRefs: mediaAudioAnalysisRefs })],
    });

    useHistoryStore.getState().captureSnapshot('audio state');

    clipAudioState.sourceAudioRevisionId = 'mutated-rev';
    clipAudioState.sourceAnalysisRefs?.spectrogramTileSetIds?.push('mutated-spectrogram');
    trackAudioState.sends?.push({ id: 'send-mutated', targetBusId: 'bus-delay', gainDb: -18, preFader: true, enabled: true });
    masterAudioState.exportPreflight?.warnings?.push({ code: 'mutated', message: 'mutated', severity: 'info' });
    mediaAudioAnalysisRefs.spectrogramTileSetIds?.push('mutated-media-spectrogram');

    const snapshot = useHistoryStore.getState().currentSnapshot!;

    expect(snapshot.timeline.clips[0].audioState?.sourceAudioRevisionId).toBe('rev-1');
    expect(snapshot.timeline.clips[0].audioState?.sourceAnalysisRefs).toEqual({
      waveformPyramidId: 'waveform-source-1',
      spectrogramTileSetIds: ['spectrogram-source-1'],
    });
    expect(snapshot.timeline.clips[0].audioState?.processedAnalysisRefs?.processedWaveformPyramidId).toBe('waveform-processed-1');
    expect(snapshot.timeline.tracks[0].audioState?.sends).toHaveLength(1);
    expect(snapshot.timeline.masterAudioState?.exportPreflight?.warnings).toHaveLength(1);
    expect(snapshot.media.files[0].audioAnalysisRefs).toEqual({
      waveformPyramidId: 'media-waveform-1',
      spectrogramTileSetIds: ['media-spectrogram-1'],
      loudnessEnvelopeId: 'media-loudness-1',
    });
    expectNoAudioPayloadFields(snapshot);
  });

  it('undo and redo restore audio state refs without payload-shaped fields', () => {
    const clipAudioState: ClipAudioState = {
      sourceAudioRevisionId: 'rev-before',
      sourceAnalysisRefs: { waveformPyramidId: 'waveform-before' },
      processedAnalysisRefs: { processedWaveformPyramidId: 'processed-before' },
    };
    const trackAudioState: TrackAudioState = {
      volumeDb: -3,
      pan: 0,
      muted: false,
      solo: false,
      recordArm: false,
      inputMonitor: false,
      meterMode: 'peak',
    };
    const masterAudioState: MasterAudioState = {
      volumeDb: -1,
      limiterEnabled: true,
      targetLufs: -16,
      truePeakCeilingDb: -1,
    };
    const mediaAudioAnalysisRefs: MediaFileAudioAnalysisRefs = {
      waveformPyramidId: 'media-waveform-before',
      beatGridId: 'beat-grid-before',
    };

    mocks.setTimelineState({
      clips: [createMockClip({ id: 'clip-1', trackId: 'a1', audioState: clipAudioState })],
      tracks: [mockTrack({ id: 'a1', audioState: trackAudioState })],
      masterAudioState,
    });
    mocks.setMediaState({
      files: [mockMediaFile({ id: 'media-1', audioAnalysisRefs: mediaAudioAnalysisRefs })],
    });
    useHistoryStore.getState().captureSnapshot('before');

    mocks.setTimelineState({
      clips: [createMockClip({ id: 'clip-1', trackId: 'a1' })],
      tracks: [mockTrack({ id: 'a1' })],
      masterAudioState: undefined,
    });
    mocks.setMediaState({
      files: [mockMediaFile({ id: 'media-1' })],
    });
    useHistoryStore.getState().captureSnapshot('after');

    useHistoryStore.getState().undo();

    expect(mocks.timeline.getState().clips[0].audioState).toEqual(clipAudioState);
    expect(mocks.timeline.getState().tracks[0].audioState).toEqual(trackAudioState);
    expect(mocks.timeline.getState().masterAudioState).toEqual(masterAudioState);
    expect(mocks.media.getState().files[0].audioAnalysisRefs).toEqual(mediaAudioAnalysisRefs);
    expectNoAudioPayloadFields(useHistoryStore.getState().currentSnapshot);

    useHistoryStore.getState().redo();

    expect(mocks.timeline.getState().clips[0].audioState).toBeUndefined();
    expect(mocks.timeline.getState().tracks[0].audioState).toBeUndefined();
    expect(mocks.timeline.getState().masterAudioState).toBeUndefined();
    expect(mocks.media.getState().files[0].audioAnalysisRefs).toBeUndefined();
  });
});
