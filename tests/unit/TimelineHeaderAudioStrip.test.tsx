import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimelineHeader } from '../../src/components/timeline/TimelineHeader';
import type { ClipTransform, TimelineTrack } from '../../src/types';

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

function renderAudioHeader(height: number) {
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
    />,
  );
}

describe('TimelineHeader audio mixer strip', () => {
  it('renders full-height audio lanes with mixer readouts and icon buttons', () => {
    const { container } = renderAudioHeader(96);

    expect(container.querySelector('.track-header.audio.audio-strip-full')).not.toBeNull();
    expect(container.querySelector('.audio-level-meter.vertical')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('.audio-track-fader')?.title).toBe('Volume -6.5 dB');
    expect(container.querySelector('.audio-track-fader-value')?.textContent).toBe('-6.5');
    expect(container.querySelector('.audio-track-pan-value')?.textContent).toBe('L35');
    expect(container.querySelectorAll('.track-header-icon').length).toBeGreaterThanOrEqual(2);
  });

  it('uses compact audio density for medium lanes without dropping core controls', () => {
    const { container } = renderAudioHeader(48);

    expect(container.querySelector('.track-header.audio.audio-strip-compact')).not.toBeNull();
    expect(container.querySelector('.audio-track-faders')).not.toBeNull();
    expect(container.querySelector('.audio-button-label-short')?.textContent).toBe('A');
    expect(container.querySelector('.audio-button-label-wide')?.textContent).toBe('Aux');
  });

  it('uses condensed audio density for short lanes', () => {
    const { container } = renderAudioHeader(24);

    expect(container.querySelector('.track-header.audio.audio-strip-condensed')).not.toBeNull();
    expect(container.querySelectorAll('.track-controls .btn-icon').length).toBeGreaterThanOrEqual(7);
  });
});
