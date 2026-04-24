import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import {
  triggerMIDITransportAction,
  triggerMarkerMIDIAction,
  triggerMarkerMIDIBinding,
  triggerSlotMIDIAction,
  triggerSlotMIDIBinding,
} from '../../src/services/midi/midiCommands';

describe('midiCommands', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  beforeEach(() => {
    globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    useMediaStore.setState({ slotAssignments: {} });
    vi.restoreAllMocks();
  });

  it('triggers transport playback actions', async () => {
    const play = vi.fn(async () => undefined);
    const pause = vi.fn();

    useTimelineStore.setState({
      isPlaying: false,
      play,
      pause,
    });

    await triggerMIDITransportAction('playPause');

    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('triggers marker jump actions from an explicit time', async () => {
    const setDraggingPlayhead = vi.fn();
    const setPlayheadPosition = vi.fn();

    useTimelineStore.setState({
      duration: 60,
      isPlaying: false,
      setDraggingPlayhead,
      setPlayheadPosition,
    });

    await triggerMarkerMIDIAction('jumpToMarker', 12.5);

    expect(setDraggingPlayhead).toHaveBeenCalledWith(false);
    expect(setPlayheadPosition).toHaveBeenCalledWith(12.5);
  });

  it('can force a marker jump to stop playback', async () => {
    const pause = vi.fn();
    const setDraggingPlayhead = vi.fn();
    const setPlayheadPosition = vi.fn();

    useTimelineStore.setState({
      duration: 60,
      isPlaying: true,
      pause,
      setDraggingPlayhead,
      setPlayheadPosition,
    });

    await triggerMarkerMIDIAction('jumpToMarkerAndStop', 8.25);

    expect(pause).toHaveBeenCalledTimes(1);
    expect(setDraggingPlayhead).toHaveBeenCalledWith(false);
    expect(setPlayheadPosition).toHaveBeenCalledWith(8.25);
  });

  it('resolves marker bindings through the same path as incoming MIDI notes', async () => {
    const play = vi.fn(async () => undefined);
    const setDraggingPlayhead = vi.fn();
    const setPlayheadPosition = vi.fn();
    const setPlaybackSpeed = vi.fn();

    useTimelineStore.setState({
      duration: 60,
      isPlaying: false,
      playbackSpeed: 1,
      play,
      setDraggingPlayhead,
      setPlayheadPosition,
      setPlaybackSpeed,
      markers: [
        {
          id: 'marker-1',
          time: 9.75,
          label: 'Drop',
          color: '#ff0',
          midiBindings: [{ action: 'playFromMarker', channel: 2, note: 40 }],
        },
      ],
    });

    await triggerMarkerMIDIBinding({
      action: 'playFromMarker',
      channel: 2,
      note: 40,
    });

    expect(setPlayheadPosition).toHaveBeenCalledWith(9.75);
    expect(play).toHaveBeenCalledTimes(1);
    expect(setPlaybackSpeed).toHaveBeenCalledWith(1);
  });

  it('triggers slot bindings on the assigned slot layer', async () => {
    const triggerLiveSlot = vi.fn();
    vi.spyOn(useMediaStore, 'getState').mockReturnValue({
      slotAssignments: {
        'comp-slot': 13,
      },
      triggerLiveSlot,
    } as ReturnType<typeof useMediaStore.getState>);

    await triggerSlotMIDIAction(13);
    await triggerSlotMIDIBinding({
      action: 'triggerSlot',
      slotIndex: 13,
      channel: 1,
      note: 36,
    });

    expect(triggerLiveSlot).toHaveBeenCalledTimes(2);
    expect(triggerLiveSlot).toHaveBeenCalledWith('comp-slot', 1);
  });
});
