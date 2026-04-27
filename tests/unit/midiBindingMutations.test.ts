import { beforeEach, describe, expect, it } from 'vitest';
import { createJSONStorage } from 'zustand/middleware';
import { useMIDIStore } from '../../src/stores/midiStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  moveMarkerMIDIBinding,
  setMarkerMIDIBinding,
  setParameterMIDIBinding,
  setSlotMIDIBinding,
  setTransportMIDIBinding,
  startLearningParameterMIDIBinding,
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
      slotBindings: {},
      parameterBindings: {},
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

  it('clears conflicting slot bindings when assigning a transport note', () => {
    setSlotMIDIBinding(0, { channel: 1, note: 64 });

    setTransportMIDIBinding('playPause', { channel: 1, note: 64 });

    expect(useMIDIStore.getState().slotBindings[0]).toBeUndefined();
    expect(useMIDIStore.getState().transportBindings.playPause).toEqual({ channel: 1, note: 64 });
  });

  it('clears conflicting transport and marker bindings when assigning a slot note', () => {
    setTransportMIDIBinding('playPause', { channel: 1, note: 64 });
    setMarkerMIDIBinding('marker-b', 'playFromMarker', { channel: 1, note: 65 });

    setSlotMIDIBinding(5, { channel: 1, note: 64 });
    setSlotMIDIBinding(6, { channel: 1, note: 65 });

    expect(useMIDIStore.getState().transportBindings.playPause).toBeNull();
    expect(useTimelineStore.getState().markers[1]?.midiBindings).toBeUndefined();
    expect(useMIDIStore.getState().slotBindings[5]).toEqual({ channel: 1, note: 64 });
    expect(useMIDIStore.getState().slotBindings[6]).toEqual({ channel: 1, note: 65 });
  });

  it('starts learn mode for a timeline parameter', () => {
    startLearningParameterMIDIBinding({
      clipId: 'clip-param',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
      currentValue: 0.5,
    });

    expect(useMIDIStore.getState().learnTarget).toEqual({
      kind: 'parameter',
      clipId: 'clip-param',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
      currentValue: 0.5,
    });
  });

  it('clears conflicting note bindings when assigning a parameter note', () => {
    setTransportMIDIBinding('playPause', { channel: 1, note: 64 });
    setMarkerMIDIBinding('marker-b', 'playFromMarker', { channel: 1, note: 65 });

    setParameterMIDIBinding({
      clipId: 'clip-param',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
    }, {
      type: 'note',
      channel: 1,
      note: 64,
    });

    setParameterMIDIBinding({
      clipId: 'clip-param',
      property: 'scale.x',
      label: 'Scale X',
      min: 0,
      max: 2,
    }, {
      type: 'note',
      channel: 1,
      note: 65,
    });

    expect(useMIDIStore.getState().transportBindings.playPause).toBeNull();
    expect(useTimelineStore.getState().markers[1]?.midiBindings).toBeUndefined();
    expect(useMIDIStore.getState().parameterBindings['parameter:clip-param:opacity']?.message).toEqual({
      type: 'note',
      channel: 1,
      note: 64,
    });
    expect(useMIDIStore.getState().parameterBindings['parameter:clip-param:scale.x']?.message).toEqual({
      type: 'note',
      channel: 1,
      note: 65,
    });
  });

  it('keeps CC assignments unique across parameter bindings', () => {
    setParameterMIDIBinding({
      clipId: 'clip-param',
      property: 'opacity',
      label: 'Opacity',
      min: 0,
      max: 1,
    }, {
      type: 'control-change',
      channel: 1,
      control: 7,
    });

    setParameterMIDIBinding({
      clipId: 'clip-param',
      property: 'scale.x',
      label: 'Scale X',
      min: 0,
      max: 2,
    }, {
      type: 'control-change',
      channel: 1,
      control: 7,
    });

    const state = useMIDIStore.getState();
    expect(state.parameterBindings['parameter:clip-param:opacity']).toBeUndefined();
    expect(state.parameterBindings['parameter:clip-param:scale.x']?.message).toEqual({
      type: 'control-change',
      channel: 1,
      control: 7,
    });
  });
});
