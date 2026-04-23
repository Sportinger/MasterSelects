import { beforeEach, describe, expect, it } from 'vitest';
import { createJSONStorage } from 'zustand/middleware';
import { useMIDIStore } from '../../src/stores/midiStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  moveMarkerMIDIBinding,
  setMarkerMIDIBinding,
  setTransportMIDIBinding,
} from '../../src/services/midi/midiBindingMutations';

describe('midiBindingMutations', () => {
  beforeEach(() => {
    useMIDIStore.persist.setOptions({
      storage: createJSONStorage(() => ({
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      })),
    });

    useMIDIStore.setState({
      isSupported: true,
      isEnabled: false,
      connectionStatus: 'idle',
      connectionError: null,
      devices: [],
      lastMessage: null,
      learnTarget: null,
      transportBindings: {
        playPause: null,
        stop: null,
      },
    });

    useTimelineStore.setState({
      duration: 60,
      markers: [
        {
          id: 'marker-a',
          time: 5,
          label: 'Intro',
          color: '#fff',
          midiBindings: [{ action: 'jumpToMarker', channel: 1, note: 60 }],
        },
        {
          id: 'marker-b',
          time: 10,
          label: 'Drop',
          color: '#fff',
          midiBindings: [{ action: 'playFromMarker', channel: 1, note: 62 }],
        },
      ],
    });
  });

  it('moves conflicting marker bindings out of the way when assigning a transport note', () => {
    setTransportMIDIBinding('playPause', { channel: 1, note: 60 });

    expect(useMIDIStore.getState().transportBindings.playPause).toEqual({ channel: 1, note: 60 });
    expect(useTimelineStore.getState().markers[0]?.midiBindings).toBeUndefined();
    expect(useTimelineStore.getState().markers[1]?.midiBindings).toEqual([
      { action: 'playFromMarker', channel: 1, note: 62 },
    ]);
  });

  it('clears conflicting transport bindings when assigning a marker note', () => {
    setTransportMIDIBinding('playPause', { channel: 1, note: 64 });

    setMarkerMIDIBinding('marker-b', 'playFromMarker', { channel: 1, note: 64 });

    expect(useMIDIStore.getState().transportBindings.playPause).toBeNull();
    expect(useTimelineStore.getState().markers[1]?.midiBindings).toEqual([
      { action: 'playFromMarker', channel: 1, note: 64 },
    ]);
  });

  it('can move an existing marker binding to another marker', () => {
    moveMarkerMIDIBinding({
      fromMarkerId: 'marker-a',
      toMarkerId: 'marker-b',
      action: 'jumpToMarker',
      binding: { channel: 1, note: 60 },
    });

    expect(useTimelineStore.getState().markers[0]?.midiBindings).toBeUndefined();
    expect(useTimelineStore.getState().markers[1]?.midiBindings).toEqual([
      { action: 'playFromMarker', channel: 1, note: 62 },
      { action: 'jumpToMarker', channel: 1, note: 60 },
    ]);
  });
});
