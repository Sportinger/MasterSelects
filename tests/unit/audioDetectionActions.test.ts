import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({
  detectRms: vi.fn(),
  extractAudio: vi.fn(),
  trimBuffer: vi.fn(),
  snap: vi.fn(),
  listArtifacts: vi.fn(),
  loadPayloads: vi.fn(),
}));

vi.mock('../../src/engine/audio/AudioExtractor', () => ({
  audioExtractor: {
    extractAudio: mocks.extractAudio,
    trimBuffer: mocks.trimBuffer,
  },
}));

vi.mock('../../src/services/audio/audioSilenceDetection', () => ({
  detectAudioSilenceRanges: mocks.detectRms,
}));

vi.mock('../../src/services/audio/sampleAccurateSnap', () => ({
  snapSourceTimeToZeroCrossing: mocks.snap,
}));

vi.mock('../../src/services/audio/timelineWaveformPyramidCache', () => ({
  createCurrentAudioArtifactStore: () => ({
    listAnalysisArtifacts: mocks.listArtifacts,
  }),
}));

vi.mock('../../src/services/agentTimeline/artifacts/audioIntelligencePayloadLoader', () => ({
  loadAudioIntelligencePayloads: mocks.loadPayloads,
}));

vi.mock('../../src/stores/historyStore', () => ({ captureSnapshot: vi.fn() }));

import { createAudioDetectionActions } from '../../src/stores/timeline/audioEdit/audioDetectionActions';

function fakeBuffer(duration = 4): AudioBuffer {
  return {
    duration,
    length: duration * 1_000,
    numberOfChannels: 1,
    sampleRate: 1_000,
    getChannelData: () => new Float32Array(duration * 1_000),
  } as unknown as AudioBuffer;
}

function audioClip(): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'voice.wav',
    file: new File([], 'voice.wav', { type: 'audio/wav' }),
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    source: { type: 'audio', mediaFileId: 'media-1' },
    transform: {} as TimelineClip['transform'],
    effects: [],
  };
}

function createActions(clip = audioClip()) {
  let state: Record<string, unknown> = {
    clips: [clip],
    tracks: [{ id: 'track-1', locked: false }],
    audioRegionSelection: null,
    updateDuration: vi.fn(),
    invalidateCache: vi.fn(),
  };
  const set = (patch: Record<string, unknown>) => { state = { ...state, ...patch }; };
  const get = () => state;
  const actions = createAudioDetectionActions(set as never, get as never);
  state = { ...state, ...actions };
  return { actions, getState: () => state };
}

describe('audioDetectionActions intelligence ladder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const buffer = fakeBuffer();
    mocks.extractAudio.mockResolvedValue(buffer);
    mocks.trimBuffer.mockReturnValue(buffer);
    mocks.listArtifacts.mockResolvedValue([]);
    mocks.loadPayloads.mockResolvedValue({});
    mocks.snap.mockImplementation((_buffer, sourceTime: number) => sourceTime + 0.005);
  });

  it('prefers VAD gaps, uses persisted loudness, and snaps both edges within 10 ms', async () => {
    mocks.listArtifacts.mockResolvedValue([{
      id: 'vad-current',
      kind: 'voice-activity',
      stale: false,
      createdAt: 10,
    }]);
    mocks.loadPayloads.mockResolvedValue({
      voiceActivity: {
        segments: [{ start: 1, end: 2, confidence: 0.95 }],
      },
      loudness: {
        curves: [{
          metric: 'rms-dbfs',
          windows: [
            { start: 0, end: 1, valueDb: -54 },
            { start: 2, end: 4, valueDb: -57 },
          ],
        }],
      },
    });
    const { actions } = createActions();

    const ranges = await actions.detectClipSilenceRanges('clip-1', {
      minSilenceSeconds: 0.5,
      paddingSeconds: 0,
    });

    expect(mocks.detectRms).not.toHaveBeenCalled();
    expect(mocks.snap).toHaveBeenCalledTimes(4);
    expect(mocks.snap).toHaveBeenCalledWith(expect.anything(), 1, { maxDistanceSeconds: 0.01 });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ start: 0.005, end: 1.005, rmsDb: -54 });
    expect(ranges[0].duration).toBeCloseTo(1, 9);
    expect(ranges[1]).toMatchObject({ start: 2.005, end: 4, rmsDb: -57 });
    expect(ranges[1].duration).toBeCloseTo(1.995, 9);
  });

  it('falls back to the unchanged RMS detector when no VAD artifact loads', async () => {
    mocks.detectRms.mockReturnValue([{ start: 0.5, end: 1.5, duration: 1, rmsDb: -62 }]);
    const { actions } = createActions();

    const ranges = await actions.detectClipSilenceRanges('clip-1');

    expect(mocks.detectRms).toHaveBeenCalledTimes(1);
    expect(ranges[0]).toMatchObject({ start: 0.505, end: 1.505, rmsDb: -62 });
    expect(ranges[0].duration).toBeCloseTo(1, 9);
  });

  it('prefers the freshest persisted room-tone profile over heuristic detection', async () => {
    mocks.listArtifacts.mockResolvedValue([{
      id: 'room-new',
      kind: 'room-tone-profile',
      stale: false,
      createdAt: 20,
      metadata: {
        roomToneProfileManifest: {
          candidates: [
            { start: 0.2, end: 0.7 },
            { start: 3.1, end: 3.6 },
          ],
        },
      },
    }]);
    const { actions, getState } = createActions();

    const operationId = await actions.applyRoomToneFill('clip-1', {
      targetRange: { start: 1.5, end: 2 },
    });

    expect(operationId).toBeTruthy();
    expect(mocks.detectRms).not.toHaveBeenCalled();
    const updatedClip = (getState().clips as TimelineClip[])[0];
    const operation = updatedClip?.audioState?.editStack?.at(-1);
    expect(operation?.params).toMatchObject({
      roomToneSourceCount: 2,
      roomToneSourceRanges: JSON.stringify([
        { start: 0.2, end: 0.7 },
        { start: 3.1, end: 3.6 },
      ]),
      sourceInPoint: 0.2,
      sourceOutPoint: 0.7,
    });
  });
});
