import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import {
  SCENE_CUT_ANALYSIS_HEIGHT,
  SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
  SCENE_CUT_ANALYSIS_WIDTH,
  SCENE_CUT_DETECTOR_VERSION,
  type SceneCutAnalysis,
} from '../../src/types/sceneCutAnalysis';

const mediaStoreMock = vi.hoisted(() => ({
  files: [] as MediaFile[],
  analyzeSceneCuts: vi.fn().mockResolvedValue(undefined),
  cancelProxyGeneration: vi.fn(),
}));
const clipAnalyzerMock = vi.hoisted(() => ({
  analyzeClip: vi.fn().mockResolvedValue(undefined),
  cancelAnalysis: vi.fn(),
}));
const transcriptMock = vi.hoisted(() => ({
  transcribeClip: vi.fn().mockResolvedValue(undefined),
  cancelTranscription: vi.fn(),
}));
const descriptionMock = vi.hoisted(() => ({
  describeClip: vi.fn().mockResolvedValue(undefined),
  cancelDescription: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore', () => {
  const useMediaStore = Object.assign(
    (selector: (state: typeof mediaStoreMock) => unknown) => selector(mediaStoreMock),
    { getState: () => mediaStoreMock },
  );
  (globalThis as typeof globalThis & {
    __mediaStoreModule?: { useMediaStore: typeof useMediaStore };
  }).__mediaStoreModule = { useMediaStore };
  return { useMediaStore };
});
vi.mock('../../src/services/clipAnalyzer', () => clipAnalyzerMock);
vi.mock('../../src/services/clipTranscriber', () => transcriptMock);
vi.mock('../../src/services/sceneDescriber', () => descriptionMock);

import { runCurrentClipAnalysis } from '../../src/services/agentTimeline/jobs/currentClipAnalysisExecution';

function currentCutAnalysis(file: File): SceneCutAnalysis {
  return {
    schemaVersion: SCENE_CUT_ANALYSIS_SCHEMA_VERSION,
    detectorVersion: SCENE_CUT_DETECTOR_VERSION,
    analysisWidth: SCENE_CUT_ANALYSIS_WIDTH,
    analysisHeight: SCENE_CUT_ANALYSIS_HEIGHT,
    sourceFrameCount: 1,
    expectedSourceFrameCount: 1,
    duration: 10,
    sourceFingerprint: { size: file.size, lastModified: file.lastModified },
    cuts: [],
    completedAt: 1,
  };
}

function prepare(options: { staleCuts?: boolean } = {}) {
  const file = new File(['video'], 'clip.mp4', { type: 'video/mp4', lastModified: 42 });
  const clip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: file.name,
    file,
    startTime: 0,
    duration: 8,
    inPoint: 1,
    outPoint: 7,
    mediaFileId: 'media-1',
    source: { type: 'video', mediaFileId: 'media-1' },
    transform: {
      position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 }, opacity: 1, anchorPoint: { x: 0.5, y: 0.5, z: 0 },
    },
    effects: [],
    analysisStatus: 'ready',
    faceAnalysisStatus: 'ready',
    transcriptStatus: 'ready',
    sceneDescriptionStatus: 'ready',
  } as TimelineClip;
  const cuts = currentCutAnalysis(file);
  if (options.staleCuts) cuts.sourceFingerprint = { size: file.size + 1, lastModified: file.lastModified };
  useTimelineStore.setState({ clips: [clip] });
  mediaStoreMock.files.splice(0, mediaStoreMock.files.length, {
    id: 'media-1', name: file.name, type: 'video', parentId: null, createdAt: 1,
    file, url: 'blob:clip', duration: 8, sceneCutStatus: 'ready', sceneCutAnalysis: cuts,
  } as MediaFile);
}

async function run(includeDescription = false) {
  return runCurrentClipAnalysis({
    clipId: 'clip-1',
    includeTranscript: true,
    includeDescription,
    localVisual: { profile: 'quick', sourceRange: { start: 1, end: 7 }, includeFaces: true },
  });
}

afterEach(() => {
  useTimelineStore.setState({ clips: [] });
  mediaStoreMock.files.splice(0, mediaStoreMock.files.length);
  vi.clearAllMocks();
});

describe('current clip analysis cache policy', () => {
  it('keeps provider scene descriptions opt-in for Analyze All', async () => {
    prepare();

    await run();

    expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledTimes(1);
    expect(transcriptMock.transcribeClip).toHaveBeenCalledTimes(1);
    expect(descriptionMock.describeClip).not.toHaveBeenCalled();
  });

  it('runs descriptions only when the caller explicitly opts in', async () => {
    prepare();

    await run(true);

    expect(descriptionMock.describeClip).toHaveBeenCalledWith('clip-1');
  });

  it('does not treat bare ready flags as compatible visual, transcript, or description caches', async () => {
    prepare({ staleCuts: true });

    await run(true);

    expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', expect.objectContaining({
      sourceRange: { start: 1, end: 7 }, sampleIntervalMs: 1000, faceSampleIntervalMs: 1000,
    }));
    expect(transcriptMock.transcribeClip).toHaveBeenCalledWith('clip-1', 'auto');
    expect(descriptionMock.describeClip).toHaveBeenCalledWith('clip-1');
    expect(mediaStoreMock.analyzeSceneCuts).toHaveBeenCalledWith('media-1', { force: false });
  });

  it('reuses only a current versioned scene-cut result with the same source fingerprint', async () => {
    prepare();

    await run();

    expect(mediaStoreMock.analyzeSceneCuts).not.toHaveBeenCalled();
  });
});
