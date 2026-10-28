import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { TransformTab } from '../../src/components/panels/properties/TransformTab';
import { useStableTransform } from '../../src/components/panels/properties/transformTab/useStableTransform';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// The memoised Transform tab must not read composition or media sizes through getState(): after the
// memo nothing else re-renders it when a composition resolution changes, media metadata or a proxy
// arrives, or the source is swapped, and the inspector would show stale pixel values and fit scale.

interface MediaFixture {
  activeCompositionId: string | null;
  compositions: Array<{ id: string; width: number; height: number }>;
  files: Array<{ id: string; type: string; width?: number; height?: number }>;
  getActiveComposition: () => { id: string; width: number; height: number } | undefined;
}

// useCameraKeyframeInteractions runs exactly once per render of the TransformTab body.
const counts = vi.hoisted(() => ({ transformTab: 0 }));
vi.mock('../../src/components/panels/properties/transformTab/useCameraKeyframeInteractions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/panels/properties/transformTab/useCameraKeyframeInteractions')>();
  return {
    ...actual,
    useCameraKeyframeInteractions: (...args: Parameters<typeof actual.useCameraKeyframeInteractions>) => {
      counts.transformTab += 1;
      return actual.useCameraKeyframeInteractions(...args);
    },
  };
});

const initialTimelineState = useTimelineStore.getState();
const track = createMockTrack({ id: 'video-1' });
let media: ReturnType<typeof createMedia>;

function createMedia() {
  return create<MediaFixture>()((_set, get) => ({
    activeCompositionId: 'comp',
    compositions: [{ id: 'comp', width: 1920, height: 1080 }, { id: 'nested', width: 640, height: 640 }],
    files: [{ id: 'media-1', type: 'video', width: 1920, height: 1080 }, { id: 'media-2', type: 'video', width: 1000, height: 1000 }],
    getActiveComposition: () => get().compositions.find(comp => comp.id === get().activeCompositionId),
  }));
}

function TransformHarness({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const playhead = useTimelineStore(state => state.playheadPosition);
  const transform = useStableTransform(useTimelineStore.getState().getInterpolatedTransform(clipId, playhead - (clip?.startTime ?? 0)));
  return <TransformTab clipId={clipId} transform={transform} is3D={false} />;
}

const positionX = () => Number(screen.getByLabelText('Position X').getAttribute('aria-valuenow') ?? screen.getByLabelText('Position X').textContent);
const clipScale = () => useTimelineStore.getState().clips.find(clip => clip.id === 'clip-t')!.transform.scale;
const setFile = (id: string, size: { width?: number; height?: number }) => act(() => media.setState(state => ({
  files: state.files.map(file => (file.id === id ? { ...file, ...size } : file)),
})));

beforeEach(() => {
  media = createMedia();
  vi.mocked(useMediaStore).mockImplementation(((selector: (state: MediaFixture) => unknown) => media(selector)) as unknown as typeof useMediaStore);
  vi.mocked(useMediaStore.getState).mockImplementation(() => media.getState() as unknown as ReturnType<typeof useMediaStore.getState>);
  const clip = createMockClip({
    id: 'clip-t', trackId: track.id, mediaFileId: 'media-1',
    source: { type: 'video', mediaFileId: 'media-1' } as TimelineClip['source'],
  });
  useTimelineStore.setState({
    ...initialTimelineState, tracks: [track], clipKeyframes: new Map(), playheadPosition: 0,
    clips: [{ ...clip, transform: { ...clip.transform, position: { x: 0.5, y: 0, z: 0 } } }],
  });
});

afterEach(() => {
  cleanup();
  act(() => useTimelineStore.setState(initialTimelineState));
});

describe('memoised Transform tab follows composition and source sizes', () => {
  it('shows the pixel position for a new composition resolution', () => {
    render(<TransformHarness clipId="clip-t" />);
    expect(positionX()).toBe(480);
    act(() => media.setState(state => ({ compositions: state.compositions.map(comp => (comp.id === 'comp' ? { ...comp, width: 3840, height: 2160 } : comp)) })));
    expect(positionX()).toBe(960);
  });

  it('shows the pixel position of the new active composition after a composition switch', () => {
    render(<TransformHarness clipId="clip-t" />);
    act(() => media.setState({ activeCompositionId: 'nested' }));
    expect(positionX()).toBe(160);
  });

  it('fits with the source size from media metadata that arrives after the first render', () => {
    setFile('media-1', { width: undefined, height: undefined });
    render(<TransformHarness clipId="clip-t" />);
    expect(screen.queryByLabelText('Fit source to composition')).toBeNull();
    setFile('media-1', { width: 3840, height: 2160 });
    fireEvent.click(screen.getByLabelText('Fit source to composition'));
    expect(clipScale().x).toBeCloseTo(0.5);
    expect(clipScale().y).toBeCloseTo(0.5);
  });

  it('fits with the new source after a proxy or replacement changes its dimensions', () => {
    render(<TransformHarness clipId="clip-t" />);
    setFile('media-1', { width: 960, height: 540 });
    fireEvent.click(screen.getByLabelText('Fit source to composition'));
    expect(clipScale().x).toBeCloseTo(2);
  });

  it('does not re-render for an unrelated media change', () => {
    let commits = 0;
    render(<Profiler id="transform" onRender={() => { commits += 1; }}><TransformHarness clipId="clip-t" /></Profiler>);
    commits = 0; counts.transformTab = 0;
    setFile('media-2', { width: 2000, height: 2000 });
    // The composition list itself is shown by the Source section's picker; a mirror write that keeps the
    // active composition's size must not re-render the tab body.
    act(() => media.setState(state => ({ compositions: state.compositions.map(comp => (comp.id === 'comp' ? { ...comp } : comp)) })));
    expect(commits).toBeLessThanOrEqual(1);
    expect(counts.transformTab).toBe(0);
  });
});
