import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VolumeTab } from '../../src/components/panels/properties/VolumeTab';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

describe('VolumeTab', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'audio-1',
          effects: [],
          source: { type: 'audio', naturalDuration: 5 },
        }),
      ],
      tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
      playheadPosition: 0,
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      runtimeAudioMeters: { trackMeters: {} },
    });
  });

  afterEach(() => {
    cleanup();
    useTimelineStore.setState({
      clips: [],
      tracks: [],
      clipKeyframes: new Map(),
      keyframeRecordingEnabled: new Set(),
      runtimeAudioMeters: { trackMeters: {} },
    });
  });

  it('does not create legacy volume or EQ effects just by rendering', () => {
    render(<VolumeTab clipId="clip-1" effects={[]} />);

    expect(useTimelineStore.getState().clips[0].effects).toEqual([]);
  });

  it('creates the legacy volume effect only when the user edits volume', () => {
    const { container } = render(<VolumeTab clipId="clip-1" effects={[]} />);
    const volumeControl = container.querySelector('.control-row .draggable-number');
    expect(volumeControl).not.toBeNull();

    fireEvent.doubleClick(volumeControl!);
    fireEvent.change(screen.getByTitle('Enter value'), { target: { value: '-6' } });
    fireEvent.keyDown(screen.getByTitle('Enter value'), { key: 'Enter' });

    const effects = useTimelineStore.getState().clips[0].effects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'audio-volume',
      params: { volume: expect.closeTo(0.501, 3) },
    });
  });
});
