import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisTab } from '../../src/components/panels/properties/AnalysisTab';
import type { MediaFile } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type {
  ClipAnalysis,
  TimelineClip,
} from '../../src/types';
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

vi.mock('../../src/stores/mediaStore', () => {
  const useMediaStore = Object.assign(
    (selector: (state: typeof mediaStoreMock) => unknown) => selector(mediaStoreMock),
    { getState: () => mediaStoreMock },
  );
  return { useMediaStore };
});

vi.mock('../../src/services/clipAnalyzer', () => clipAnalyzerMock);
vi.mock('../../src/services/sceneDescriber', () => sceneDescriberMock);

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

afterEach(() => {
  cleanup();
  useTimelineStore.setState({ clips: [] });
  mediaStoreMock.files.splice(0, mediaStoreMock.files.length);
  mediaStoreMock.analyzeSceneCuts.mockReset();
  mediaStoreMock.cancelProxyGeneration.mockReset();
  vi.clearAllMocks();
});

describe('AnalysisTab scene-cut counter', () => {
  it('shows the number of source cuts inside the selected clip range', () => {
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

    const cutsRow = screen.getByText('Cuts:').parentElement;
    expect(cutsRow?.textContent).toBe('Cuts:2');
    expect(cutsRow?.querySelector('[title="4 in source"]')).toBeTruthy();
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

    expect(screen.getByText('Analyzing 37%')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Clear Analysis' }) as HTMLButtonElement).disabled,
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

    const cutsAction = screen.getByText('Scene Cuts').closest('.analysis-action-row');
    expect(cutsAction).toBeTruthy();
    fireEvent.click(within(cutsAction as HTMLElement).getByRole('button', { name: 'Analyze' }));
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

    const cutsAction = screen.getByText('Scene Cuts').closest('.analysis-action-row');
    expect(cutsAction).toBeTruthy();
    fireEvent.click(within(cutsAction as HTMLElement).getByRole('button', { name: 'Retry' }));
    expect(mediaStoreMock.analyzeSceneCuts).toHaveBeenCalledWith('media-1', {
      force: true,
    });
  });

  it('offers independent reanalysis actions for metrics and faces', async () => {
    prepareStores('ready');

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

    const metricsAction = screen.getByText('Focus & Motion').closest('.analysis-action-row');
    const facesAction = screen.getByText('Faces', { selector: '.analysis-action-title' })
      .closest('.analysis-action-row');
    expect(metricsAction).toBeTruthy();
    expect(facesAction).toBeTruthy();

    fireEvent.click(within(metricsAction as HTMLElement).getByRole('button', { name: 'Reanalyze' }));
    await vi.waitFor(() => {
      expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', {
        target: 'metrics',
        force: true,
      });
    });

    fireEvent.click(within(facesAction as HTMLElement).getByRole('button', { name: 'Analyze' }));
    await vi.waitFor(() => {
      expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', {
        target: 'faces',
        force: false,
      });
    });
  });

  it('analyzes every channel sequentially from the top-level action', async () => {
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
      fireEvent.click(screen.getByRole('button', { name: 'Analyze All' }));
    });

    await vi.waitFor(() => {
      expect(clipAnalyzerMock.analyzeClip).toHaveBeenCalledWith('clip-1', {
        target: 'all',
        force: false,
      });
      expect(mediaStoreMock.analyzeSceneCuts).toHaveBeenCalledWith('media-1', {
        force: false,
      });
      expect(sceneDescriberMock.describeClip).toHaveBeenCalledWith('clip-1');
    });
    expect(clipAnalyzerMock.analyzeClip.mock.invocationCallOrder[0])
      .toBeLessThan(mediaStoreMock.analyzeSceneCuts.mock.invocationCallOrder[0]);
    expect(mediaStoreMock.analyzeSceneCuts.mock.invocationCallOrder[0])
      .toBeLessThan(sceneDescriberMock.describeClip.mock.invocationCallOrder[0]);
  });
});
