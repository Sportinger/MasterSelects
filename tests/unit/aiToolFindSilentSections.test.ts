import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createArtifactStore: vi.fn(),
  detectClipSilenceRanges: vi.fn(),
  loadPayloads: vi.fn(),
  selectClipAndOpenTab: vi.fn(),
}));

vi.mock('../../src/services/audio/timelineWaveformPyramidCache', () => ({
  createCurrentAudioArtifactStore: mocks.createArtifactStore,
}));
vi.mock('../../src/services/agentTimeline/artifacts/audioIntelligencePayloadLoader', () => ({
  loadAudioIntelligencePayloads: mocks.loadPayloads,
}));
vi.mock('../../src/services/audio/audioSilenceDetection', () => ({
  detectClipSilenceRanges: mocks.detectClipSilenceRanges,
}));
vi.mock('../../src/services/aiTools/aiFeedback', () => ({
  selectClipAndOpenTab: mocks.selectClipAndOpenTab,
}));
vi.mock('../../src/services/aiTools/executionState', () => ({
  isAIExecutionActive: () => false,
}));

import { handleFindSilentSections } from '../../src/services/aiTools/handlers/clipSilence';
import { handleStartClipAudioIntelligence } from '../../src/services/aiTools/handlers/analysisStarters';
import { analysisToolDefinitions } from '../../src/services/aiTools/definitions/analysis';
import { timelineHandlers } from '../../src/services/aiTools/handlers/timelineHandlerRegistry';
import { getToolPolicy } from '../../src/services/aiTools/policy/registry';

function createStore(overrides: Record<string, unknown> = {}) {
  return {
    clips: [{
      duration: 10,
      id: 'clip-1',
      inPoint: 10,
      mediaFileId: 'media-1',
      name: 'Interview',
      outPoint: 20,
      startTime: 30,
      trackId: 'track-1',
      transcript: [
        { id: 'w1', start: 10, end: 12, alignedStart: 10.5, alignedEnd: 12.5, alignmentConfidence: 0.9, text: 'one' },
        { id: 'w2', start: 15, end: 18, alignedStart: 16, alignedEnd: 18, alignmentConfidence: 0.8, text: 'two' },
      ],
    }],
    generateAudioIntelligenceForClip: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}

function dataOf(result: Awaited<ReturnType<typeof handleFindSilentSections>>) {
  return result.data as {
    detectionSource: string;
    silentSections: Array<Record<string, number>>;
  };
}

describe('findSilentSections signal ladder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createArtifactStore.mockReturnValue({ listAnalysisArtifacts: vi.fn().mockResolvedValue([{}]) });
  });

  it('uses VAD gaps including head and tail before any RMS decode', async () => {
    mocks.loadPayloads.mockResolvedValue({
      voiceActivity: {
        segments: [
          { start: 11, end: 12, confidence: 0.8 },
          { start: 14, end: 17, confidence: 0.6 },
          { start: 19, end: 19.5, confidence: 0.9 },
        ],
      },
    });

    const result = await handleFindSilentSections({ clipId: 'clip-1', minDuration: 0.5 }, createStore());
    const data = dataOf(result);

    expect(result.success).toBe(true);
    expect(data.detectionSource).toBe('voice-activity');
    expect(data.silentSections).toMatchObject([
      { sourceStart: 10, sourceEnd: 11, timelineStart: 30, timelineEnd: 31, meanProbability: 0.8 },
      { sourceStart: 12, sourceEnd: 14, meanProbability: 0.7 },
      { sourceStart: 17, sourceEnd: 19, meanProbability: 0.75 },
      { sourceStart: 19.5, sourceEnd: 20, meanProbability: 0.9 },
    ]);
    expect(mocks.detectClipSilenceRanges).not.toHaveBeenCalled();
  });

  it('falls back to bounded RMS ranges and exposes rmsDb', async () => {
    mocks.loadPayloads.mockResolvedValue({});
    mocks.detectClipSilenceRanges.mockResolvedValue([
      { start: 11, end: 13, duration: 2, rmsDb: -61.25 },
    ]);

    const result = await handleFindSilentSections({ clipId: 'clip-1', minDuration: 1 }, createStore());
    const data = dataOf(result);

    expect(data.detectionSource).toBe('rms');
    expect(data.silentSections).toEqual([{
      sourceStart: 11,
      sourceEnd: 13,
      duration: 2,
      rmsDb: -61.25,
      timelineStart: 31,
      timelineEnd: 33,
    }]);
    expect(mocks.detectClipSilenceRanges).toHaveBeenCalledWith(expect.anything(), {
      minSilenceSeconds: 1,
      sourceOffsetSeconds: 10,
    });
  });

  it('uses effective transcript timings only when signal detection is unavailable', async () => {
    mocks.loadPayloads.mockResolvedValue({});
    mocks.detectClipSilenceRanges.mockRejectedValue(new Error('decode unavailable'));

    const result = await handleFindSilentSections({ clipId: 'clip-1', minDuration: 0.5 }, createStore());
    const data = dataOf(result);

    expect(data.detectionSource).toBe('transcript-gaps');
    expect(data.silentSections).toMatchObject([
      { sourceStart: 10, sourceEnd: 10.5, duration: 0.5 },
      { sourceStart: 12.5, sourceEnd: 16, duration: 3.5 },
      { sourceStart: 18, sourceEnd: 20, duration: 2 },
    ]);
  });
});

describe('startClipAudioIntelligence', () => {
  it('is defined, registered, mutating-low like transcription, and starts the store action', async () => {
    const generate = vi.fn().mockResolvedValue(undefined);
    const result = await handleStartClipAudioIntelligence({
      clipId: 'clip-1',
      features: ['vad', 'speech-markers'],
    }, createStore({ generateAudioIntelligenceForClip: generate }));

    expect(result).toMatchObject({ success: true, data: { started: true } });
    expect(generate).toHaveBeenCalledWith('clip-1', {
      features: new Set(['vad', 'speech-markers']),
    });
    expect(timelineHandlers.startClipAudioIntelligence).toBe(handleStartClipAudioIntelligence);
    expect(analysisToolDefinitions.some(tool => tool.function.name === 'startClipAudioIntelligence')).toBe(true);
    expect(getToolPolicy('startClipAudioIntelligence')).toMatchObject({
      readOnly: false,
      riskLevel: 'low',
      requiresConfirmation: false,
    });
  });
});