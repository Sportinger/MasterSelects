import { describe, expect, it, vi } from 'vitest';
import { analysisToolDefinitions } from '../../src/services/aiTools/definitions/analysis';
import {
  handleGetTimelineAnalysis,
  type AgentTimelineAiToolDependencies,
} from '../../src/services/aiTools/handlers/agentTimeline';
import { getToolPolicy } from '../../src/services/aiTools/policy';
import { FLASHBOARD_CHAT_TOOLS } from '../../src/services/flashboard/FlashBoardChatTools';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types/timeline';
import type { SceneCutAnalysis } from '../../src/types/sceneCutAnalysis';

const SOURCE_HASH = 'ab'.repeat(32);
const LONG_SOURCE_DURATION_SECONDS = 301;

function clip(id: string, startTime: number, file: File): TimelineClip {
  return {
    id,
    trackId: 'video-track',
    name: id,
    file,
    startTime,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'video', mediaFileId: 'media-a', file, naturalDuration: 10 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    analysisStatus: 'ready',
    analysis: {
      sampleInterval: 1_000,
      frames: [{
        timestamp: 0,
        motion: .2,
        globalMotion: .2,
        localMotion: .1,
        focus: .8,
        brightness: .7,
        faceCount: 1,
        faces: [{
          id: 'face-a',
          personId: 'person-a',
          label: 'Person A',
          confidence: .92,
          box: { x: .1, y: .2, width: .3, height: .4 },
          landmarks: [],
        }],
      }],
      faceAnalysis: {
        schemaVersion: 1,
        modelVersion: 'face-model-test',
        detector: 'YuNet',
        recognizer: 'SFace',
        backend: 'cached',
        observationCount: 1,
        people: [{
          id: 'person-a',
          label: 'Person A',
          firstSeen: 0,
          lastSeen: 4,
          sampleCount: 1,
          averageConfidence: .92,
          maxConfidence: .92,
          appearances: [{ start: 0, end: 4 }],
        }],
      },
    },
    transcriptStatus: 'ready',
    transcript: [
      { id: 'hello', text: 'Hello', start: 1, end: 1.4, speaker: 'S1', confidence: .9 },
    ],
    sceneDescriptionStatus: 'ready',
    sceneDescriptions: [{ id: 'scene-a', text: 'A person speaks.', start: 0, end: 3 }],
  };
}

function sceneCuts(): SceneCutAnalysis {
  return {
    schemaVersion: 1,
    detectorVersion: 'content-adaptive-160x90-v2',
    analysisWidth: 160,
    analysisHeight: 90,
    sourceFrameCount: 300,
    expectedSourceFrameCount: 300,
    duration: 10,
    sourceFingerprint: { size: 7, lastModified: 1 },
    completedAt: 1,
    cuts: [{
      timestamp: 2,
      frameNumber: 60,
      score: .9,
      changedRatio: .8,
      meanPixelDifference: .7,
      histogramDifference: .6,
      edgeChangeRatio: .5,
      motionCompensatedDifference: .4,
      confidence: .95,
    }],
  };
}

function media(file: File): MediaFile {
  return {
    id: 'media-a',
    name: 'source.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    url: 'blob:source',
    file,
    duration: 10,
    sceneCutStatus: 'ready',
    sceneCutAnalysis: sceneCuts(),
    transcriptStatus: 'ready',
    transcript: [
      { id: 'hello', text: 'Hello', start: 1, end: 1.4, speaker: 'S1', confidence: .9 },
    ],
    transcribedRanges: [[0, 10]],
    waveform: [.1, .3, .2, .4, .2, .1, .3, .2, .1, .2],
    waveformStatus: 'ready',
  };
}

function stores(options: {
  selectedClipId?: string;
  clips?: TimelineClip[];
  speedKeyframes?: boolean;
} = {}) {
  const file = new File(['payload'], 'source.mp4', {
    type: 'video/mp4',
    lastModified: 1,
  });
  const clips = options.clips ?? [clip('clip-a', 0, file), clip('clip-b', 20, file)];
  const selectedClipId = options.selectedClipId;
  const clipKeyframes = new Map();
  if (options.speedKeyframes) {
    clipKeyframes.set('clip-a', [{
      id: 'speed-a',
      clipId: 'clip-a',
      time: 0,
      property: 'speed',
      value: 1,
      easing: 'linear',
    }]);
  }
  const timelineStore = {
    clips,
    primarySelectedClipId: selectedClipId ?? null,
    selectedClipIds: new Set(selectedClipId ? [selectedClipId] : []),
    clipKeyframes,
  } as unknown as Parameters<typeof handleGetTimelineAnalysis>[1];
  const mediaStore = {
    files: [media(file)],
    selectedIds: selectedClipId ? [] : ['media-a'],
    activeCompositionId: 'comp-a',
  } as unknown as Parameters<typeof handleGetTimelineAnalysis>[2];
  return { timelineStore, mediaStore };
}

function dependencies() {
  const showAnalysis = vi.fn();
  const value: AgentTimelineAiToolDependencies = {
    getSourceIdentity: vi.fn().mockResolvedValue({
      type: 'source-identity',
      version: 'agent-timeline-source-identity/v1',
      strategy: 'sampled-chunks',
      hashAlgorithm: 'sha-256',
      hash: SOURCE_HASH,
      metadata: { size: 7, mediaType: 'video/mp4' },
    }),
    listAudioArtifacts: vi.fn().mockResolvedValue([]),
    showAnalysis,
  };
  return { value, showAnalysis };
}

describe('getTimelineAnalysis AI tool', () => {
  it('reads bounded legacy source artifacts without frames and opens Analysis for a clip target', async () => {
    const { timelineStore, mediaStore } = stores({ selectedClipId: 'clip-a' });
    const deps = dependencies();

    const result = await handleGetTimelineAnalysis({
      start: 0,
      end: 5,
      timeDomain: 'source',
      channels: [
        'speech',
        'cuts',
        'quality',
        'scenes',
        'camera-motion',
        'people',
        'audio',
      ],
      limit: 900,
      maxBytes: 999_999,
      includeText: true,
      externalDataConsent: 'share-transcript-and-scene-descriptions',
    }, timelineStore, mediaStore, deps.value);

    expect(result.success).toBe(true);
    const data = result.data as {
      bounds: { limit: number; maxBytes: number };
      page: {
        events: Array<{ type: string }>;
        query: { includeFrames: boolean };
        coverage: Array<{ channel: string; status: string }>;
      };
      supplement: {
        schemaVersion: string;
        scenes: Array<{
          descriptions: Array<{ text: string }>;
          speakerTurns: Array<{ speakerId: string; text: string }>;
          people: Array<{ personId: string }>;
          signals: {
            focus?: { avg: number };
            motion?: { avg: number };
            audioLevel?: { avg: number };
          };
        }>;
        overview: Array<{ signal: string; bins: unknown[] }>;
      };
    };
    expect(data.bounds).toEqual({ limit: 500, maxBytes: 256 * 1024 });
    expect(data.page.events.map((event) => event.type)).toEqual([
      'camera-motion',
      'person-visible',
      'speech',
      'cut',
    ]);
    expect(data.page.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'quality', status: 'partial' }),
      expect.objectContaining({ channel: 'scenes', status: 'partial' }),
    ]));
    expect(data.page.query.includeFrames).toBe(false);
    expect(data.supplement.schemaVersion).toBe('agent-timeline-ai-supplement/v1');
    expect(data.supplement.scenes).toHaveLength(2);
    expect(data.supplement.scenes[0]).toMatchObject({
      descriptions: [{ text: 'A person speaks.' }],
      speakerTurns: [{ speakerId: 'S1', text: 'Hello' }],
      people: [{ personId: 'person-a' }],
      signals: {
        focus: { avg: .8 },
        motion: { avg: .2 },
      },
    });
    expect(data.supplement.scenes[0]?.signals.audioLevel?.avg).toBeGreaterThan(0);
    expect(data.supplement.overview.map((signal) => signal.signal)).toEqual([
      'focus',
      'motion',
      'audio-level',
    ]);
    expect(data.supplement.overview.every((signal) => signal.bins.length > 0)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/screenshots|framePayloads|"frames"/);
    expect(deps.value.getSourceIdentity).toHaveBeenCalledWith(expect.any(File));
    expect(deps.showAnalysis).toHaveBeenCalledWith('clip-a');
  });

  it('withholds transcript and scene-description strings unless explicit external consent is given', async () => {
    const { timelineStore, mediaStore } = stores({ selectedClipId: 'clip-a' });
    const deps = dependencies();

    const result = await handleGetTimelineAnalysis({
      start: 0,
      end: 5,
      timeDomain: 'source',
      channels: ['speech', 'scenes', 'people', 'quality'],
    }, timelineStore, mediaStore, deps.value);

    expect(result.success).toBe(true);
    const data = result.data as {
      page: { events: Array<{ type: string; data: Record<string, unknown> }> };
      supplement: { scenes: Array<{ descriptions: unknown[]; speakerTurns: unknown[] }> };
    };
    expect(data.page.events.find((event) => event.type === 'speech')?.data).toEqual({
      speakerId: 'S1',
      wordCount: 1,
    });
    expect(data.supplement.scenes.every((scene) => (
      scene.descriptions.length === 0 && scene.speakerTurns.length === 0
    ))).toBe(true);
    expect(JSON.stringify(data)).not.toContain('Hello');
    expect(JSON.stringify(data)).not.toContain('A person speaks.');
  });

  it('fails closed on a long persistent-index miss instead of materializing legacy source data', async () => {
    const { timelineStore, mediaStore } = stores({ selectedClipId: 'clip-a' });
    const mutableMediaStore = mediaStore as unknown as { files: MediaFile[] };
    mutableMediaStore.files[0] = {
      ...mutableMediaStore.files[0],
      duration: LONG_SOURCE_DURATION_SECONDS,
    };
    const deps = dependencies();

    const result = await handleGetTimelineAnalysis({
      start: 0,
      end: 5,
      timeDomain: 'source',
      channels: ['speech'],
    }, timelineStore, mediaStore, deps.value);

    expect(result).toMatchObject({
      success: false,
      data: {
        error: {
          code: 'index-required',
          legacyFallback: { sourceDurationSeconds: LONG_SOURCE_DURATION_SECONDS },
        },
      },
    });
    expect(deps.showAnalysis).not.toHaveBeenCalled();
  });

  it('projects one canonical event onto repeated current-composition occurrences', async () => {
    const { timelineStore, mediaStore } = stores();
    const deps = dependencies();

    const result = await handleGetTimelineAnalysis({
      mediaFileId: 'media-a',
      start: 0,
      end: 30,
      timeDomain: 'composition',
      channels: ['cuts'],
    }, timelineStore, mediaStore, deps.value);

    expect(result.success).toBe(true);
    const data = result.data as {
      page: {
        events: Array<{ type: string }>;
        occurrences: Array<{ clipId: string }>;
      };
    };
    expect(data.page.events).toHaveLength(1);
    expect(data.page.occurrences.map((item) => item.clipId).toSorted()).toEqual([
      'clip-a',
      'clip-b',
    ]);
    expect(deps.showAnalysis).not.toHaveBeenCalled();
  });

  it('returns a structured mapping failure instead of reinterpreting speed-keyframed clip time', async () => {
    const { timelineStore, mediaStore } = stores({
      selectedClipId: 'clip-a',
      speedKeyframes: true,
    });
    const deps = dependencies();

    const result = await handleGetTimelineAnalysis({
      start: 0,
      end: 5,
      timeDomain: 'clip-local',
      channels: ['speech'],
    }, timelineStore, mediaStore, deps.value);

    expect(result).toMatchObject({
      success: false,
      data: {
        ok: false,
        error: {
          code: 'mapping-unavailable',
          requestedTimeDomain: 'clip-local',
        },
      },
    });
    expect(deps.value.getSourceIdentity).not.toHaveBeenCalled();
  });

  it('rejects frame-shaped requests at the tool boundary', async () => {
    const { timelineStore, mediaStore } = stores({ selectedClipId: 'clip-a' });
    const deps = dependencies();
    const result = await handleGetTimelineAnalysis({
      start: 0,
      end: 5,
      timeDomain: 'source',
      channels: ['cuts'],
      includeFrames: true,
    }, timelineStore, mediaStore, deps.value);

    expect(result).toMatchObject({
      success: false,
      data: { error: { code: 'invalid-request' } },
    });
    expect(deps.value.getSourceIdentity).not.toHaveBeenCalled();
  });

  it('reports requested audio-store failures instead of presenting them as missing analysis', async () => {
    const { timelineStore, mediaStore } = stores({ selectedClipId: 'clip-a' });
    const deps = dependencies();
    deps.value.listAudioArtifacts = vi.fn().mockRejectedValue(new Error('audio index unavailable'));

    const result = await handleGetTimelineAnalysis({
      start: 0,
      end: 5,
      timeDomain: 'source',
      channels: ['audio'],
    }, timelineStore, mediaStore, deps.value);

    expect(result).toMatchObject({
      success: false,
      error: 'audio index unavailable',
      data: { error: { code: 'read-failed', retryable: true } },
    });
  });

  it('is provider-exposed as read-only with no frame or screenshot parameter', () => {
    const definition = analysisToolDefinitions.find((tool) => (
      tool.function.name === 'getTimelineAnalysis'
    ));
    expect(definition).toBeDefined();
    expect(definition?.function.parameters.required).toEqual([
      'start', 'end', 'timeDomain', 'channels',
    ]);
    expect(definition?.function.parameters.properties).not.toHaveProperty('includeFrames');
    expect(definition?.function.parameters.properties).not.toHaveProperty('frames');
    expect(definition?.function.parameters.properties).not.toHaveProperty('screenshots');
    expect(definition?.function.parameters.properties).toHaveProperty('includeText');
    expect(definition?.function.parameters.properties).toHaveProperty('externalDataConsent');
    expect(getToolPolicy('getTimelineAnalysis')).toMatchObject({
      readOnly: true,
      requiresConfirmation: false,
    });
    expect(FLASHBOARD_CHAT_TOOLS.some((tool) => (
      tool.function.name === 'getTimelineAnalysis'
    ))).toBe(true);
  });
});
