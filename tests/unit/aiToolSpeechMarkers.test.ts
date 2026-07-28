import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createArtifactStore: vi.fn(),
  loadPayloads: vi.fn(),
}));

vi.mock('../../src/services/audio/timelineWaveformPyramidCache', () => ({
  createCurrentAudioArtifactStore: mocks.createArtifactStore,
}));
vi.mock('../../src/services/agentTimeline/artifacts/audioIntelligencePayloadLoader', () => ({
  loadAudioIntelligencePayloads: mocks.loadPayloads,
}));

import { handleGetSpeechMarkers } from '../../src/services/aiTools/handlers/speechMarkers';
import { analysisToolDefinitions } from '../../src/services/aiTools/definitions/analysis';
import { timelineHandlers } from '../../src/services/aiTools/handlers/timelineHandlerRegistry';
import { getToolPolicy } from '../../src/services/aiTools/policy/registry';

function createStore() {
  return {
    clips: [{
      duration: 5,
      id: 'clip-1',
      inPoint: 10,
      mediaFileId: 'media-1',
      outPoint: 20,
      speed: 2,
      startTime: 30,
    }],
  } as never;
}

function prosodyArtifact() {
  return {
    clipAudioStateHash: undefined,
    createdAt: 20,
    id: 'prosody-new',
    kind: 'prosody-contour',
    metadata: {
      prosodyContourManifest: {
        summary: { medianF0Hz: 142, meanSpeechRateSps: 4.25 },
      },
    },
    stale: false,
  } as never;
}

describe('getSpeechMarkers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createArtifactStore.mockReturnValue({
      listAnalysisArtifacts: vi.fn().mockResolvedValue([prosodyArtifact()]),
    });
  });

  it('clamps the source range, filters kinds, maps timeline time, and pages', async () => {
    mocks.loadPayloads.mockResolvedValue({
      speechMarkers: {
        markers: [
          { id: 'm1', type: 'filler', start: 9.5, end: 10.5, confidence: 0.7, text: 'um' },
          { id: 'm2', type: 'breath', start: 11, end: 11.2, confidence: 0.8 },
          { id: 'm3', type: 'filler', start: 12, end: 13, confidence: 0.9, wordIds: ['w3'] },
          { id: 'm4', type: 'filler', start: 14, end: 16, confidence: 0.6 },
        ],
      },
    });

    const result = await handleGetSpeechMarkers({
      clipId: 'clip-1',
      sourceStart: 9,
      sourceEnd: 15,
      kinds: ['filler'],
      offset: 1,
      limit: 1,
    }, createStore());
    const data = result.data as Record<string, unknown> & {
      markers: Array<Record<string, unknown>>;
    };

    expect(result.success).toBe(true);
    expect(data).toMatchObject({
      hasMarkers: true,
      sourceRange: { start: 10, end: 15 },
      markerCount: 4,
      matchingMarkerCount: 3,
      offset: 1,
      limit: 1,
      returned: 1,
      hasMore: true,
      nextOffset: 2,
      counts: { filler: 3 },
      summary: { medianF0Hz: 142, meanSpeechRateSps: 4.25 },
    });
    expect(data.markers).toEqual([{
      id: 'm3',
      type: 'filler',
      start: 12,
      end: 13,
      timelineStart: 31,
      timelineEnd: 31.5,
      confidence: 0.9,
      wordIds: ['w3'],
    }]);
    expect(timelineHandlers.getSpeechMarkers).toBe(handleGetSpeechMarkers);
    expect(analysisToolDefinitions.some(tool => tool.function.name === 'getSpeechMarkers')).toBe(true);
    expect(getToolPolicy('getSpeechMarkers')).toMatchObject({ readOnly: true, riskLevel: 'low' });
  });

  it('returns a successful generation hint when no speech-marker artifact exists', async () => {
    mocks.loadPayloads.mockResolvedValue({});

    const result = await handleGetSpeechMarkers({ clipId: 'clip-1' }, createStore());

    expect(result).toMatchObject({
      success: true,
      data: {
        hasMarkers: false,
        returned: 0,
        hasMore: false,
        nextOffset: null,
        markers: [],
        hint: expect.stringContaining('startClipAudioIntelligence'),
      },
    });
  });
});