import { Profiler } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from '../../src/components/panels/properties';
import { EffectsTab } from '../../src/components/panels/properties/EffectsTab';
import { TransformTab } from '../../src/components/panels/properties/TransformTab';
import { effectsDependOnPlayhead } from '../../src/components/panels/properties/effectsPlayheadDependency';
import { useStableTransform } from '../../src/components/panels/properties/transformTab/useStableTransform';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip } from '../../src/types/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// An inspector drag writes the edited clip on every sample. These tests count renders of trees the
// drag must not touch (catalog tiles, the other transform section, the whole panel for another
// clip) and check that the values that do change are still shown (no stale UI).

const renders = vi.hoisted(() => ({ lookTiles: 0, anchorRows: 0, cropReads: 0 }));

vi.mock('../../src/components/panels/looks/LookTile', () => ({
  LookTile: ({ look }: { look: { name: string } }) => {
    renders.lookTiles += 1;
    return <div data-testid="look-tile">{look.name}</div>;
  },
}));

// AnchorPointRows renders once per Transform-section render; readResolveCropValues runs once per
// render of the Composite/Crop sections (ResolveVisualInspectorSections).
vi.mock('../../src/components/panels/properties/transformTab/AnchorPointRows', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/panels/properties/transformTab/AnchorPointRows')>();
  return {
    ...actual,
    AnchorPointRows: (props: Parameters<typeof actual.AnchorPointRows>[0]) => {
      renders.anchorRows += 1;
      return actual.AnchorPointRows(props);
    },
  };
});
vi.mock('../../src/components/panels/properties/transformTab/resolveCropMask', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/panels/properties/transformTab/resolveCropMask')>();
  return {
    ...actual,
    readResolveCropValues: (...args: Parameters<typeof actual.readResolveCropValues>) => {
      renders.cropReads += 1;
      return actual.readResolveCropValues(...args);
    },
  };
});

const initialTimelineState = useTimelineStore.getState();
const track = createMockTrack({ id: 'video-1' });

function resetRenderCounts() {
  renders.lookTiles = 0;
  renders.anchorRows = 0;
  renders.cropReads = 0;
}

function brightness(id: string, amount: number): Effect {
  return { id, type: 'brightness', name: 'Brightness', enabled: true, params: { amount } };
}

function videoClip(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id, trackId: track.id, mediaFileId: `media-${id}`,
    source: { type: 'video', mediaFileId: `media-${id}` } as TimelineClip['source'],
    ...overrides,
  });
}

function editClip(clipId: string, edit: (clip: TimelineClip) => TimelineClip) {
  act(() => useTimelineStore.setState(state => ({
    clips: state.clips.map(clip => (clip.id === clipId ? edit(clip) : clip)),
  })));
}

function setEffectAmount(clipId: string, effectId: string, amount: number) {
  editClip(clipId, clip => ({
    ...clip,
    effects: clip.effects.map(effect => (effect.id === effectId ? { ...effect, params: { ...effect.params, amount } } : effect)),
  }));
}

function setOpacity(clipId: string, opacity: number) {
  editClip(clipId, clip => ({ ...clip, transform: { ...clip.transform, opacity } }));
}

function setPositionX(clipId: string, x: number) {
  editClip(clipId, clip => ({ ...clip, transform: { ...clip.transform, position: { ...clip.transform.position, x } } }));
}

function amountKeyframe(clipId: string, effectId: string, time: number, value: number): Keyframe {
  return { id: `kf-${time}`, clipId, time, property: `effect.${effectId}.amount` as Keyframe['property'], value, easing: 'linear' };
}

/** Reads the clip's effects the way PropertiesClipTabContent hands them to the Effects tab. */
function EffectsHarness({ clipId }: { clipId: string }) {
  const effects = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.effects ?? []);
  return <EffectsTab clipId={clipId} effects={effects} />;
}

/** Interpolates and stabilises the transform the way PropertiesPanel does. */
function TransformHarness({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const playhead = useTimelineStore(state => state.playheadPosition);
  const transform = useStableTransform(useTimelineStore.getState().getInterpolatedTransform(clipId, playhead - (clip?.startTime ?? 0)));
  return <TransformTab clipId={clipId} transform={transform} is3D={false} />;
}

beforeEach(() => {
  const mediaState = {
    activeCompositionId: null,
    compositions: [],
    files: [],
    slotAssignments: {},
    selectedSlotCompositionId: null,
    getActiveComposition: () => ({ width: 1920, height: 1080 }),
    selectSlotComposition: vi.fn(),
    ensureSlotClipSettings: vi.fn(),
    updateLiveInputSource: vi.fn(),
  };
  vi.mocked(useMediaStore).mockImplementation(((selector: (state: typeof mediaState) => unknown) => (
    selector(mediaState)
  )) as typeof useMediaStore);
  vi.mocked(useMediaStore.getState).mockReturnValue(mediaState as unknown as ReturnType<typeof useMediaStore.getState>);
  resetRenderCounts();
});

afterEach(() => {
  cleanup();
  act(() => useTimelineStore.setState(initialTimelineState));
});

describe('Effects tab render fan-out', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      ...initialTimelineState,
      tracks: [track],
      clips: [
        videoClip('clip-fx', { effects: [brightness('fx-a', 0.1), brightness('fx-b', 0.2)] }),
        videoClip('clip-other', { startTime: 10 }),
      ],
      clipKeyframes: new Map(),
      playheadPosition: 0,
    });
  });

  it('does not re-render the collapsed catalog tiles while an effect value is dragged', () => {
    render(<EffectsHarness clipId="clip-fx" />);
    expect(screen.getAllByTestId('look-tile').length).toBeGreaterThan(50);
    resetRenderCounts();

    for (let sample = 1; sample <= 20; sample += 1) setEffectAmount('clip-fx', 'fx-a', sample / 50);

    expect(renders.lookTiles).toBe(0);
    // The dragged value itself is shown.
    expect(screen.getAllByLabelText('Amount')[0]).toHaveAttribute('aria-valuenow', '0.4');

    // A new playhead frame still refreshes the tile thumbnails' source frame.
    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    expect(renders.lookTiles).toBeGreaterThan(50);
  });

  it('ignores the playhead and other clips when nothing on the clip is time-dependent', () => {
    let commits = 0;
    render(
      <Profiler id="effects" onRender={() => { commits += 1; }}>
        <EffectsHarness clipId="clip-fx" />
      </Profiler>,
    );
    commits = 0;

    // Playhead ticks within one catalog frame (1/30 s) and edits of another clip.
    for (let tick = 1; tick <= 10; tick += 1) act(() => useTimelineStore.setState({ playheadPosition: tick / 1000 }));
    for (let sample = 1; sample <= 10; sample += 1) setOpacity('clip-other', 1 - sample / 100);

    expect(commits).toBe(0);
  });

  it('follows the playhead once the clip has keyframes, so interpolated values never go stale', () => {
    render(<EffectsHarness clipId="clip-fx" />);
    act(() => useTimelineStore.setState({
      clipKeyframes: new Map([['clip-fx', [amountKeyframe('clip-fx', 'fx-a', 0, 0), amountKeyframe('clip-fx', 'fx-a', 2, 1)]]]),
    }));
    expect(screen.getAllByLabelText('Amount')[0]).toHaveAttribute('aria-valuenow', '0');

    act(() => useTimelineStore.setState({ playheadPosition: 1 }));
    expect(screen.getAllByLabelText('Amount')[0]).toHaveAttribute('aria-valuenow', '0.5');
  });

  it('names every time input of the interpolated effects', () => {
    const clip = videoClip('clip-time');
    expect(effectsDependOnPlayhead(clip, undefined)).toBe(false);
    expect(effectsDependOnPlayhead(clip, [])).toBe(false);
    expect(effectsDependOnPlayhead(clip, [amountKeyframe('clip-time', 'fx', 0, 1)])).toBe(true);
    expect(effectsDependOnPlayhead({ ...clip, planarTracks: [{} as never] }, undefined)).toBe(true);
    expect(effectsDependOnPlayhead({ ...clip, effects: [{ ...brightness('cable', 0), type: 'face-cables' }] }, undefined)).toBe(true);
    expect(effectsDependOnPlayhead({ ...clip, effects: [{ ...brightness('rig', 0), type: 'stick-figure' }] }, undefined)).toBe(true);
    expect(effectsDependOnPlayhead({
      ...clip,
      nodeGraph: { parameterSources: { targets: { 'effect.fx.amount': {} } } } as unknown as TimelineClip['nodeGraph'],
    }, undefined)).toBe(true);
  });
});

describe('Transform tab render fan-out', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      ...initialTimelineState,
      tracks: [track],
      clips: [videoClip('clip-t'), videoClip('clip-other', { startTime: 10 })],
      clipKeyframes: new Map(),
      playheadPosition: 0,
    });
  });

  it('re-renders only the section whose values change during a drag', () => {
    render(<TransformHarness clipId="clip-t" />);
    expect(renders.anchorRows).toBeGreaterThan(0);
    expect(renders.cropReads).toBeGreaterThan(0);

    resetRenderCounts();
    for (let sample = 1; sample <= 10; sample += 1) setOpacity('clip-t', 1 - sample / 100);
    // Opacity lives in the Composite section; the spatial Transform section is skipped.
    expect(renders.anchorRows).toBe(0);
    expect(renders.cropReads).toBe(10);

    resetRenderCounts();
    for (let sample = 1; sample <= 10; sample += 1) setPositionX('clip-t', sample / 100);
    expect(renders.anchorRows).toBe(10);
    expect(renders.cropReads).toBe(0);

    resetRenderCounts();
    // Playhead ticks without keyframes and edits of another clip touch neither section.
    for (let tick = 1; tick <= 10; tick += 1) act(() => useTimelineStore.setState({ playheadPosition: tick / 10 }));
    for (let sample = 1; sample <= 10; sample += 1) setOpacity('clip-other', 1 - sample / 100);
    expect(renders.anchorRows).toBe(0);
    expect(renders.cropReads).toBe(0);
  });
});

describe('Properties panel render fan-out', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      ...initialTimelineState,
      tracks: [track],
      clips: [videoClip('clip-p'), videoClip('clip-other', { startTime: 10 })],
      clipKeyframes: new Map(),
      playheadPosition: 0,
      selectedClipIds: new Set(['clip-p']),
      primarySelectedClipId: 'clip-p',
      propertiesSelection: { kind: 'clip', clipId: 'clip-p' },
    });
  });

  it('does not re-render for another clip, and shows the selected clip\'s new values', async () => {
    let commits = 0;
    render(
      <Profiler id="properties" onRender={() => { commits += 1; }}>
        <PropertiesPanel />
      </Profiler>,
    );
    await screen.findAllByText('Opacity');
    commits = 0;

    for (let sample = 1; sample <= 20; sample += 1) setOpacity('clip-other', 1 - sample / 100);
    expect(commits).toBe(0);

    resetRenderCounts();
    setOpacity('clip-p', 0.4);
    expect(commits).toBeGreaterThan(0);
    expect(renders.anchorRows).toBe(0);
    const opacityValue = screen.getAllByRole('slider').find(element => element.getAttribute('aria-label') === 'Opacity');
    expect(opacityValue).toHaveAttribute('aria-valuenow', '40');

    // A different selection still switches the panel to that clip.
    act(() => useTimelineStore.setState({
      selectedClipIds: new Set(['clip-other']),
      primarySelectedClipId: 'clip-other',
      propertiesSelection: { kind: 'clip', clipId: 'clip-other' },
    }));
    const otherOpacity = screen.getAllByRole('slider').find(element => element.getAttribute('aria-label') === 'Opacity');
    expect(otherOpacity).toHaveAttribute('aria-valuenow', '80');
  });

  it('follows the parent of a parented clip, whose composed transform lives outside the selected clip', async () => {
    act(() => useTimelineStore.setState({
      clips: [
        videoClip('clip-parent'),
        videoClip('clip-child', { parentClipId: 'clip-parent' }),
        videoClip('clip-other', { startTime: 10 }),
      ],
      selectedClipIds: new Set(['clip-child']),
      primarySelectedClipId: 'clip-child',
      propertiesSelection: { kind: 'clip', clipId: 'clip-child' },
    }));
    let commits = 0;
    render(
      <Profiler id="properties" onRender={() => { commits += 1; }}>
        <PropertiesPanel />
      </Profiler>,
    );
    await screen.findAllByText('Opacity');
    const rotationSlider = () => screen.getByLabelText('Rotation Angle slider');
    expect(rotationSlider()).toHaveAttribute('aria-valuenow', '0');

    // Only the parent changes (an agent tool, an undo or the parent's own drag): the child object
    // and its keyframes keep their identity, yet the composed rotation must follow.
    editClip('clip-parent', clip => ({
      ...clip,
      transform: { ...clip.transform, rotation: { ...clip.transform.rotation, z: 30 } },
    }));
    expect(rotationSlider()).toHaveAttribute('aria-valuenow', '30');

    // The parent's keyframes are part of the chain too.
    act(() => useTimelineStore.setState(state => {
      const clipKeyframes = new Map(state.clipKeyframes);
      clipKeyframes.set('clip-parent', [{
        id: 'kf-parent-rot', clipId: 'clip-parent', time: 0, property: 'rotation.z', value: 45, easing: 'linear',
      } as Keyframe]);
      return { clipKeyframes };
    }));
    expect(rotationSlider()).toHaveAttribute('aria-valuenow', '45');

    // An unrelated clip still does not re-render the panel.
    commits = 0;
    for (let sample = 1; sample <= 10; sample += 1) setOpacity('clip-other', 1 - sample / 100);
    expect(commits).toBe(0);
  });
});
