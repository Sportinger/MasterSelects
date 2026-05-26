import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineHeader } from '../../src/components/timeline/TimelineHeader';
import { createDefaultAudioEqParams } from '../../src/engine/audio/eq/AudioEqDefaults';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineHeaderProps } from '../../src/components/timeline/types';
import type { AnimatableProperty, ClipTransform, TimelineTrack } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

function createAudioTrack(height: number): TimelineTrack {
  return {
    id: `audio-${height}`,
    name: 'Audio 1',
    type: 'audio',
    height,
    visible: true,
    muted: false,
    solo: false,
    locked: false,
    audioState: {
      volumeDb: -6.5,
      pan: -0.35,
      muted: false,
      solo: false,
      recordArm: false,
      inputMonitor: true,
      inputDeviceId: 'device-main',
      sends: [{ id: 'send-1', targetBusId: 'bus-aux', gainDb: -12, preFader: false, enabled: true }],
      effectStack: [],
      meterMode: 'peak',
    },
  } as TimelineTrack;
}

function defaultTransform(): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function renderAudioHeader(height: number, props: Partial<TimelineHeaderProps> = {}) {
  const track = createAudioTrack(height);

  return render(
    <TimelineHeader
      track={track}
      tracks={[track]}
      isDimmed={false}
      isExpanded={false}
      baseHeight={height}
      dynamicHeight={height}
      hasKeyframes={false}
      selectedClipIds={new Set()}
      clips={[]}
      playheadPosition={0}
      onToggleExpand={vi.fn()}
      onToggleSolo={vi.fn()}
      onToggleLocked={vi.fn()}
      onToggleMuted={vi.fn()}
      onToggleVisible={vi.fn()}
      onRenameTrack={vi.fn()}
      onContextMenu={vi.fn()}
      onWheel={vi.fn()}
      clipKeyframes={new Map()}
      getClipKeyframes={() => []}
      getInterpolatedTransform={defaultTransform}
      getInterpolatedEffects={() => []}
      addKeyframe={vi.fn()}
      setPlayheadPosition={vi.fn()}
      setPropertyValue={vi.fn()}
      expandedCurveProperties={new Map()}
      onToggleCurveExpanded={vi.fn()}
      onSetTrackParent={vi.fn()}
      onTrackPickWhipDragStart={vi.fn()}
      onTrackPickWhipDragEnd={vi.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TimelineHeader audio mixer strip', () => {
  it('renders full-height audio lanes with mixer readouts and icon buttons', () => {
    const { container } = renderAudioHeader(96);

    expect(container.querySelector('.track-header.audio.audio-strip-full')).not.toBeNull();
    expect(container.querySelector('.audio-level-meter.vertical')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('.audio-track-fader')?.title).toBe('Volume -6.5 dB. Double-click to reset.');
    expect(container.querySelector('.audio-track-fader-value')?.textContent).toBe('-6.5');
    expect(container.querySelector('.audio-track-pan-value')?.textContent).toBe('L35');
    expect(container.querySelector<HTMLInputElement>('.audio-track-pan-inline')?.style.getPropertyValue('--pan-fill-start')).toBe('32.5%');
    expect(container.querySelector<HTMLInputElement>('.audio-track-pan-inline')?.style.getPropertyValue('--pan-fill-end')).toBe('50%');
    expect(container.querySelectorAll('.track-header-icon').length).toBeGreaterThanOrEqual(2);
  });

  it('resets audio pan and volume sliders on double-click', () => {
    const state = useTimelineStore.getState();
    const panSpy = vi.spyOn(state, 'setTrackAudioPan').mockImplementation(() => undefined);
    const volumeSpy = vi.spyOn(state, 'setTrackAudioVolumeDb').mockImplementation(() => undefined);
    const { container } = renderAudioHeader(96);

    const panInput = container.querySelector<HTMLInputElement>('.audio-track-pan-inline');
    const volumeInput = container.querySelector<HTMLInputElement>('.audio-track-fader');

    expect(panInput).not.toBeNull();
    expect(volumeInput).not.toBeNull();

    fireEvent.doubleClick(panInput!);
    fireEvent.doubleClick(volumeInput!);

    expect(panSpy).toHaveBeenCalledWith('audio-96', 0);
    expect(volumeSpy).toHaveBeenCalledWith('audio-96', 0);
  });

  it('uses compact audio density for medium lanes without dropping core controls', () => {
    const { container } = renderAudioHeader(48);

    expect(container.querySelector('.track-header.audio.audio-strip-compact')).not.toBeNull();
    expect(container.querySelector('.audio-track-faders')).not.toBeNull();
    expect(container.querySelector('.audio-button-label-short')?.textContent).toBe('A');
    expect(container.querySelector('.audio-button-label-wide')?.textContent).toBe('Aux');
  });

  it('renders basic audio layer mode with only solo, mute, and lock controls', () => {
    const { container } = renderAudioHeader(96, { audioLayerAdvancedMode: false });

    expect(container.querySelector('.track-header.audio.audio-layer-basic')).not.toBeNull();
    expect(container.querySelector('.audio-level-meter.vertical')).toBeNull();
    expect(container.querySelector('.audio-track-fader')).toBeNull();
    expect(container.querySelector('.audio-track-pan-inline')).toBeNull();

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.track-controls .btn-icon'));
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.textContent).toBe('S');
    expect(buttons[1]?.textContent).toBe('M');
    expect(buttons.some(button => button.textContent === 'R')).toBe(false);
    expect(buttons.some(button => button.textContent === 'FX')).toBe(false);
    expect(buttons.some(button => button.textContent?.includes('Aux'))).toBe(false);
  });

  it('uses condensed audio density for short lanes', () => {
    const { container } = renderAudioHeader(24);

    expect(container.querySelector('.track-header.audio.audio-strip-condensed')).not.toBeNull();
    expect(container.querySelectorAll('.track-controls .btn-icon').length).toBeGreaterThanOrEqual(7);
  });

  it('shows nested EQ keyframe rows with readable labels and current values', () => {
    const track = createAudioTrack(96);
    const eq = createDefaultAudioEqParams();
    eq.audible.bands = eq.audible.bands.map(band => (
      band.id === 'band31' ? { ...band, gainDb: 4.5 } : band
    ));
    const clip = createMockClip({
      id: 'clip-eq',
      trackId: track.id,
      source: { type: 'audio', naturalDuration: 5 },
      effects: [{ id: 'eq-1', name: 'EQ', type: 'audio-eq', enabled: true, params: { eq } }],
    });
    const property = 'effect.eq-1.eq.audible.bands.band31.gainDb' as AnimatableProperty;

    const { container } = render(
      <TimelineHeader
        track={track}
        tracks={[track]}
        isDimmed={false}
        isExpanded
        baseHeight={96}
        dynamicHeight={120}
        hasKeyframes
        selectedClipIds={new Set([clip.id])}
        clips={[clip]}
        playheadPosition={0}
        onToggleExpand={vi.fn()}
        onToggleSolo={vi.fn()}
        onToggleLocked={vi.fn()}
        onToggleMuted={vi.fn()}
        onToggleVisible={vi.fn()}
        onRenameTrack={vi.fn()}
        onContextMenu={vi.fn()}
        onWheel={vi.fn()}
        clipKeyframes={new Map([[clip.id, [{
          id: 'kf-eq',
          clipId: clip.id,
          time: 0,
          property,
          value: 4.5,
          easing: 'linear',
        }]]])}
        getClipKeyframes={() => []}
        getInterpolatedTransform={defaultTransform}
        getInterpolatedEffects={() => [{ id: 'eq-1', type: 'audio-eq', name: 'EQ', params: { eq } }]}
        addKeyframe={vi.fn()}
        setPlayheadPosition={vi.fn()}
        setPropertyValue={vi.fn()}
        expandedCurveProperties={new Map()}
        onToggleCurveExpanded={vi.fn()}
        onSetTrackParent={vi.fn()}
        onTrackPickWhipDragStart={vi.fn()}
        onTrackPickWhipDragEnd={vi.fn()}
      />,
    );

    expect(container.querySelector('.property-label')?.textContent).toBe('31Hz Gain');
    expect(container.querySelector('.property-value')?.textContent).toBe('+4.5dB');
  });
});
