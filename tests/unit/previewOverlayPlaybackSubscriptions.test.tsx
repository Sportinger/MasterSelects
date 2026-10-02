import { Profiler, createRef, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RotoPreviewOverlay } from '../../src/components/preview/RotoPreviewOverlay';
import { PreciseFaceOverlay } from '../../src/components/preview/PreciseFaceOverlay';
import { TrackingPreviewOverlay } from '../../src/components/preview/tracking/TrackingPreviewOverlay';
import { NativeLiveInputPreview } from '../../src/components/preview/NativeLiveInputPreview';
import { StoryboardAnimaticPreviewOverlay } from '../../src/components/preview/storyboard/StoryboardAnimaticPreviewOverlay';
import { CaptionWordPreviewEditor } from '../../src/components/preview/CaptionWordPreviewEditor';
import { useTimelineStore } from '../../src/stores/timeline';
import { useTrackingEditorStore } from '../../src/stores/trackingEditorStore';
import type { TimelineClip } from '../../src/types/timeline';

const mocks = vi.hoisted(() => ({ resolveStoryboard: vi.fn(() => null) }));

vi.mock('../../src/stores/timeline', async () => {
  const { create } = await import('zustand');
  return { useTimelineStore: create(() => ({
    clips: [], layers: [], tracks: [], selectedClipIds: new Set<string>(),
    clipKeyframes: new Map(), playheadPosition: 0,
    isPlaying: false, isExporting: false, playbackWarmup: null,
    selectClip: vi.fn(), invalidateCache: vi.fn(),
  })) };
});
vi.mock('../../src/stores/mediaStore', async () => {
  const { create } = await import('zustand');
  return { useMediaStore: create(() => ({ activeCompositionId: 'comp', files: [] })) };
});
vi.mock('../../src/stores/storyboardStore', async () => {
  const { create } = await import('zustand');
  return { useStoryboardStore: create(() => ({})) };
});
vi.mock('../../src/stores/trackingStore', async () => {
  const { create } = await import('zustand');
  return { useTrackingStore: create(() => ({ assets: [] })) };
});
vi.mock('../../src/services/layerBuilder', () => ({ layerBuilder: { invalidateCache: vi.fn() } }));
vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: { requestRender: vi.fn(), requestNewFrameRender: vi.fn() },
}));
vi.mock('../../src/services/landmarkTracking/landmarkRuntime', () => ({ landmarkRuntime: { getSeries: vi.fn() } }));
vi.mock('../../src/services/storyboard/animaticCandidates', () => ({
  resolveStoryboardCandidateAwareAnimaticFramePayload: mocks.resolveStoryboard,
}));
vi.mock('../../src/services/storyboard/animatic/previewAdapter', () => ({ renderStoryboardAnimaticPreviewFrame: vi.fn() }));
vi.mock('../../src/services/captions/captionTimelineEditing', () => ({ deleteCaptionTimelineRange: vi.fn() }));
vi.mock('../../src/services/captions/captionTextRuntime', () => ({ getCaptionWordEditSnapshot: vi.fn() }));
vi.mock('../../src/services/transcription/artifactPersistence', () => ({
  correctTranscriptWordFromCaption: vi.fn(), getTranscriptWordForCaptionEdit: vi.fn(),
}));
vi.mock('../../src/components/panels/media/LiveInputPreviewCanvas', () => ({ LiveInputPreviewCanvas: () => null }));

const initialTimeline = useTimelineStore.getState();
const resolution = { width: 400, height: 300 };
const overlayProps = { displayedCompId: 'comp', width: 400, height: 300, resolution };
const storyboardProps = {
  displayedCompositionId: 'comp', width: 400, height: 300, displayWidth: 400, displayHeight: 300,
};

beforeEach(() => {
  useTimelineStore.setState(initialTimeline, true);
  useTrackingEditorStore.setState({ active: false });
  vi.clearAllMocks();
});
afterEach(cleanup);

function profiled(element: ReactNode) {
  const commits = vi.fn();
  render(<Profiler id="overlay" onRender={commits}>{element}</Profiler>);
  commits.mockClear();
  return commits;
}

describe('inactive preview overlays during playback', () => {
  const cases: [string, ReactNode][] = [
    ['Roto', <RotoPreviewOverlay {...overlayProps} />],
    ['precise face', <PreciseFaceOverlay canvasWidth={400} canvasHeight={300} displayWidth={400} displayHeight={300} />],
    ['tracking', <TrackingPreviewOverlay {...overlayProps} />],
    ['native live input', <NativeLiveInputPreview canvasSize={resolution} clips={[]} tracks={[]} enabled />],
    ['storyboard', <StoryboardAnimaticPreviewOverlay {...storyboardProps} />],
    ['caption input', <CaptionWordPreviewEditor
      canvasInContainer={{ x: 0, y: 0, ...resolution }} canvasSize={resolution}
      canvasWrapperRef={createRef<HTMLDivElement>()} effectiveResolution={resolution}
      enabled overlayRef={createRef<HTMLCanvasElement>()} viewZoom={1}
    />],
  ];

  it.each(cases)('%s does not commit for a playhead-only update', (_name, element) => {
    const commits = profiled(element);
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    expect(commits).not.toHaveBeenCalled();
  });

  it('restores tracking updates when its editor opens and releases them when it closes', () => {
    const commits = profiled(<TrackingPreviewOverlay {...overlayProps} />);
    act(() => useTrackingEditorStore.setState({ active: true }));
    commits.mockClear();
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    expect(commits).toHaveBeenCalled();

    act(() => useTrackingEditorStore.setState({ active: false }));
    commits.mockClear();
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    expect(commits).not.toHaveBeenCalled();
  });

  it('starts animatic sampling when a storyboard clip is added and stops when removed', () => {
    profiled(<StoryboardAnimaticPreviewOverlay {...storyboardProps} />);
    expect(mocks.resolveStoryboard).not.toHaveBeenCalled();
    act(() => useTimelineStore.setState({ clips: [{
      id: 'scene', source: { type: 'storyboard' }, storyboardProperties: { sceneId: 'scene' },
    } as TimelineClip] }));
    expect(mocks.resolveStoryboard).toHaveBeenCalled();
    mocks.resolveStoryboard.mockClear();
    act(() => useTimelineStore.setState({ playheadPosition: 1.5 }));
    expect(mocks.resolveStoryboard).toHaveBeenLastCalledWith(expect.objectContaining({ time: 1.5 }));

    act(() => useTimelineStore.setState({ clips: [] }));
    mocks.resolveStoryboard.mockClear();
    act(() => useTimelineStore.setState({ playheadPosition: 2 }));
    expect(mocks.resolveStoryboard).not.toHaveBeenCalled();
  });
});
