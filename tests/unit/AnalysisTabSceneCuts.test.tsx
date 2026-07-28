import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisTab } from '../../src/components/panels/properties/AnalysisTab';
import type { MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { ClipAnalysis } from '../../src/types/clipMetadata';
import type { TimelineClip } from '../../src/types/timeline';
import type {
  SceneCutAnalysis,
  SceneCutPoint,
} from '../../src/types/sceneCutAnalysis';

const mediaStoreMock = vi.hoisted(() => ({
  files: [] as MediaFile[],
  analyzeSceneCuts: vi.fn(),
  cancelProxyGeneration: vi.fn(),
}));

const clipAnalyzerMock = vi.hoisted(() => ({
  analyzeClip: vi.fn().mockResolvedValue(undefined),
  cancelAnalysis: vi.fn(),
  clearClipAnalysis: vi.fn().mockResolvedValue(undefined),
  isAnalysisRunning: vi.fn(() => true),
  recoverStaleAnalysis: vi.fn(),
}));

const sceneDescriberMock = vi.hoisted(() => ({
  describeClip: vi.fn().mockResolvedValue(undefined),
}));

const clipTranscriberMock = vi.hoisted(() => ({
  transcribeClip: vi.fn().mockResolvedValue(undefined),
  clearClipTranscript: vi.fn(),
}));

const runCurrentClipAnalysisMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../src/stores/mediaStore', () => {
  const useMediaStore = Object.assign(
    (selector: (state: typeof mediaStoreMock) => unknown) => selector(mediaStoreMock),
    {
      getState: () => mediaStoreMock,
      subscribe: () => () => undefined,
    },
  );
  (globalThis as typeof globalThis & {
    __mediaStoreModule?: { useMediaStore: typeof useMediaStore };
  }).__mediaStoreModule = { useMediaStore };
  return { useMediaStore };
});

vi.mock('../../src/services/clipAnalyzer', () => clipAnalyzerMock);
vi.mock('../../src/services/sceneDescriber', () => sceneDescriberMock);
vi.mock('../../src/services/clipTranscriber', () => clipTranscriberMock);
vi.mock('../../src/services/agentTimeline/runtime/persistence/agentTimelineRuntimePersistence', () => ({
  startAgentTimelineRuntimePersistence: vi.fn(),
}));
vi.mock('../../src/services/agentTimeline/jobs/currentClipAnalysisExecution', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  runCurrentClipAnalysis: runCurrentClipAnalysisMock,
}));

function createSceneCut(timestamp: number, frameNumber: number): SceneCutPoint {
  return {
    timestamp,
    frameNumber,
    score: 1,
    changedRatio: 1,
    meanPixelDifference: 1,
    histogramDifference: 1,
    edgeChangeRatio: 1,
    motionCompensatedDifference: 1,
    confidence: 1,
  };
}

function createSceneCutAnalysis(timestamps: readonly number[]): SceneCutAnalysis {
  return {
    schemaVersion: 1,
    detectorVersion: 'content-adaptive-160x90-v2',
    analysisWidth: 160,
    analysisHeight: 90,
    sourceFrameCount: 300,
    expectedSourceFrameCount: 300,
    duration: 10,
    sourceFingerprint: { size: 5, lastModified: 1 },
    cuts: timestamps.map(createSceneCut),
    completedAt: 1,
  };
}

const clipAnalysis: ClipAnalysis = {
  sampleInterval: 500,
  frames: [{
    timestamp: 3,
    motion: 0.2,
    globalMotion: 0.2,
    localMotion: 0.1,
    focus: 0.9,
    brightness: 0.5,
    faceCount: 0,
  }],
};

// Frames covering the whole 2s-8s range at the balanced cadence, so the
// metrics channel reads as fully analyzed (pill intent = Reanalyze).
const fullCoverageAnalysis: ClipAnalysis = {
  sampleInterval: 500,
  frames: Array.from({ length: 13 }, (_, index) => ({
    timestamp: 2 + index * 0.5,
    motion: 0.2,
    globalMotion: 0.2,
    localMotion: 0.1,
    focus: 0.9,
    brightness: 0.5,
    faceCount: 0,
  })),
};

function prepareStores(
  sceneCutStatus: MediaFile['sceneCutStatus'],
  sceneCutProgress = 100,
  includeSceneCutAnalysis = true,
) {
  const sourceFile = new File(['video'], 'clip.mp4', {
    type: 'video/mp4',
    lastModified: 1,
  });
  const clip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'clip.mp4',
    file: sourceFile,
    startTime: 0,
    duration: 6,
    inPoint: 2,
    outPoint: 8,
    mediaFileId: 'media-1',
    source: {
      type: 'video',
      mediaFileId: 'media-1',
      naturalDuration: 10,
      videoElement: document.createElement('video'),
    },
    transform: {
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      opacity: 1,
      anchorPoint: { x: 0.5, y: 0.5, z: 0 },
    },
    effects: [],
  } as TimelineClip;

  useTimelineStore.setState({
    clips: [clip],
    playheadPosition: 3,
  });
  mediaStoreMock.files.splice(0, mediaStoreMock.files.length, {
    id: 'media-1',
    name: 'clip.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    file: sourceFile,
    url: 'blob:clip',
    duration: 10,
    hasAudio: false,
    sceneCutStatus,
    sceneCutProgress,
    sceneCutAnalysis: includeSceneCutAnalysis
      ? createSceneCutAnalysis([1, 3, 7, 9])
      : undefined,
  } as MediaFile);
}

function cutsPill(): HTMLButtonElement {
  const pill = document.querySelector<HTMLButtonElement>('.analysis-action-pill--cuts');
  expect(pill).toBeTruthy();
  return pill as HTMLButtonElement;
}

function metricsPill(): HTMLButtonElement {
  const pill = document.querySelector<HTMLButtonElement>('.analysis-action-pill--metrics');
  expect(pill).toBeTruthy();
  return pill as HTMLButtonElement;
}

function facesPill(): HTMLButtonElement {
  const pill = document.querySelector<HTMLButtonElement>('.analysis-action-pill--faces');
  expect(pill).toBeTruthy();
  return pill as HTMLButtonElement;
}

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Analysis settings' }));
}

afterEach(() => {
  cleanup();
  useTimelineStore.setState({ clips: [] });
  mediaStoreMock.files.splice(0, mediaStoreMock.files.length);
  mediaStoreMock.analyzeSceneCuts.mockReset();
  mediaStoreMock.cancelProxyGeneration.mockReset();
  runCurrentClipAnalysisMock.mockClear();
  vi.clearAllMocks();
});

describe('AnalysisTab scene-cut counter', () => {
  it('shows the source cut count on the cuts pill', () => {
    prepareStores('ready');
    expect(useTimelineStore.getState().clips[0]?.source?.mediaFileId).toBe('media-1');
    expect(mediaStoreMock.files[0]?.sceneCutAnalysis?.cuts).toHaveLength(4);

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={clipAnalysis}
        analysisStatus="ready"
        analysisProgress={100}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    const pill = cutsPill();
    expect(pill.title).toContain('4 cuts');
    expect(pill.querySelector('strong')?.textContent).toBe('4');
  });

  it('shows scene-cut scan progress while analysis is running', () => {
    prepareStores('analyzing', 37);

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={clipAnalysis}
        analysisStatus="analyzing"
        analysisProgress={20}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    expect(cutsPill().title).toContain('37%');
    openSettings();
    expect(
      (screen.getByRole('button', { name: 'Clear analysis' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the counter and starts scene-cut analysis without regular clip-analysis frames', () => {
    prepareStores('none', 0, false);

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={undefined}
        analysisStatus="none"
        analysisProgress={0}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    fireEvent.click(cutsPill());
    expect(mediaStoreMock.analyzeSceneCuts).toHaveBeenCalledWith('media-1', {
      force: false,
    });
  });

  it('offers a forced retry when a failed scan left an older cut cache', () => {
    prepareStores('error');

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={clipAnalysis}
        analysisStatus="ready"
        analysisProgress={100}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    fireEvent.click(cutsPill());
    expect(mediaStoreMock.analyzeSceneCuts).toHaveBeenCalledWith('media-1', {
      force: true,
    });
  });

  it('offers independent reanalysis actions for metrics and faces', async () => {
    prepareStores('ready');

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={fullCoverageAnalysis}
        analysisStatus="ready"
        analysisProgress={100}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    fireEvent.click(metricsPill());
    await vi.waitFor(() => {
      expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', expect.objectContaining({
        target: 'metrics',
        force: true,
        sourceRange: { start: 2, end: 8 },
        sampleIntervalMs: 500,
      }));
    });

    fireEvent.click(facesPill());
    await vi.waitFor(() => {
      expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', expect.objectContaining({
        target: 'faces',
        force: false,
        sourceRange: { start: 2, end: 8 },
        faceSampleIntervalMs: 500,
      }));
    });
  });

  it('starts the analyze-all orchestrator with the resolved local visual scope', async () => {
    prepareStores('none', 0, false);

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={undefined}
        analysisStatus="none"
        analysisProgress={0}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Analyze all' }));
    });

    await vi.waitFor(() => {
      expect(runCurrentClipAnalysisMock).toHaveBeenCalledWith(expect.objectContaining({
        clipId: 'clip-1',
        localVisual: expect.objectContaining({
          profile: 'balanced',
          sourceRange: { start: 2, end: 8 },
          includeFaces: true,
        }),
      }));
    });
  });

  it('forwards supported scope and Quick cadence to the local visual runner', async () => {
    prepareStores('none', 0, false);

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={undefined}
        analysisStatus="none"
        analysisProgress={0}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    openSettings();
    expect(screen.getByRole('group', { name: 'Analysis scope' })).toHaveTextContent('Scope');
    expect(screen.getByRole('button', { name: 'Used Ranges' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Selection' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Quick' }));
    expect(screen.getByRole('button', { name: 'Quick' })).toHaveAttribute('aria-pressed', 'true');

    await act(async () => {
      fireEvent.click(metricsPill());
    });
    await vi.waitFor(() => {
      expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', expect.objectContaining({
        target: 'metrics',
        force: false,
        sourceRange: { start: 2, end: 8 },
        sampleIntervalMs: 1000,
      }));
    });
  });

  it('does not falsely run Deep or source-wide face identities', () => {
    prepareStores('none', 0, false);

    render(
      <AnalysisTab
        clipId="clip-1"
        analysis={undefined}
        analysisStatus="none"
        analysisProgress={0}
        clipStartTime={0}
        inPoint={2}
        outPoint={8}
      />,
    );

    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Deep' }));
    expect(screen.getByRole('button', { name: /Analyze all|Analyzing…/ })).toBeDisabled();
    expect(metricsPill().disabled).toBe(true);
    fireEvent.click(metricsPill());
    expect(clipAnalyzerMock.analyzeClip).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Balanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    const faces = facesPill();
    expect(faces.disabled).toBe(true);
    expect(faces.title).toContain('Unavailable for source scope');
    fireEvent.click(faces);
    expect(clipAnalyzerMock.analyzeClip).not.toHaveBeenCalled();
  });
});
