import { describe, expect, it } from 'vitest';
import { collectMIDIMappingSummary, getSlotGridLabel } from '../../src/services/midi/midiMappingSummary';
import type { TimelineMarker } from '../../src/stores/timeline/types';
import type { MIDIParameterBindings } from '../../src/types/midi';

describe('collectMIDIMappingSummary', () => {
  it('collects transport and marker mappings into a single sorted list', () => {
    const markers: TimelineMarker[] = [
      {
        id: 'marker-1',
        time: 12,
        label: 'Drop',
        color: '#fff',
        midiBindings: [{ action: 'playFromMarker', channel: 1, note: 64 }],
      },
      {
        id: 'marker-3',
        time: 18,
        label: 'Brake',
        color: '#fff',
        midiBindings: [{ action: 'jumpToMarkerAndStop', channel: 1, note: 66 }],
      },
      {
        id: 'marker-2',
        time: 4,
        label: '',
        color: '#fff',
        midiBindings: [{ action: 'jumpToMarker', channel: 1, note: 60 }],
      },
    ];

    const result = collectMIDIMappingSummary(
      {
        playPause: { channel: 1, note: 62 },
        stop: null,
      },
      markers
    );

    expect(result).toHaveLength(4);
    expect(result.map((entry) => entry.binding.note)).toEqual([60, 62, 64, 66]);
    expect(result[0]).toMatchObject({
      scope: 'marker',
      action: 'jumpToMarker',
      targetLabel: 'Marker at 00:04',
    });
    expect(result[1]).toMatchObject({
      scope: 'transport',
      action: 'playPause',
      targetLabel: 'Global Transport',
    });
    expect(result[2]).toMatchObject({
      scope: 'marker',
      action: 'playFromMarker',
      targetLabel: 'Drop at 00:12',
    });
    expect(result[3]).toMatchObject({
      scope: 'marker',
      action: 'jumpToMarkerAndStop',
      behaviorLabel: 'Move the playhead to the marker time and stop playback',
      targetLabel: 'Brake at 00:18',
    });
  });

  it('formats long marker times with hours', () => {
    const result = collectMIDIMappingSummary(
      {
        playPause: null,
        stop: null,
      },
      [{
        id: 'marker-3',
        time: 3723,
        label: 'Long',
        color: '#fff',
        midiBindings: [{ action: 'jumpToMarker', channel: 2, note: 10 }],
      }]
    );

    expect(result[0]?.targetLabel).toBe('Long at 01:02:03');
  });

  it('collects slot mappings with grid labels and composition names', () => {
    const result = collectMIDIMappingSummary(
      {
        playPause: null,
        stop: null,
      },
      [],
      {
        0: { channel: 1, note: 36 },
        13: { channel: 1, note: 37 },
      },
      [
        { slotIndex: 13, label: 'B2', compositionName: 'Loop B' },
      ]
    );

    expect(getSlotGridLabel(0)).toBe('A1');
    expect(getSlotGridLabel(13)).toBe('B2');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      scope: 'slot',
      action: 'triggerSlot',
      targetLabel: 'A1',
      behaviorLabel: 'Trigger this slot on its layer',
    });
    expect(result[1]).toMatchObject({
      scope: 'slot',
      action: 'triggerSlot',
      targetLabel: 'B2 - Loop B',
    });
  });

  it('collects parameter mappings including control-change bindings', () => {
    const parameterBindings: MIDIParameterBindings = {
      'parameter:clip-1:opacity': {
        id: 'parameter:clip-1:opacity',
        clipId: 'clip-1',
        property: 'opacity',
        label: 'Opacity',
        min: 0,
        max: 1,
        invert: true,
        damping: true,
        message: {
          type: 'control-change',
          channel: 2,
          control: 74,
        },
      },
      'parameter:clip-1:scale.x': {
        id: 'parameter:clip-1:scale.x',
        clipId: 'clip-1',
        property: 'scale.x',
        properties: ['scale.x', 'scale.y'],
        label: 'Scale',
        min: 0,
        max: 4,
        message: {
          type: 'note',
          channel: 1,
          note: 40,
        },
      },
    };

    const result = collectMIDIMappingSummary(
      {
        playPause: null,
        stop: null,
      },
      [],
      {},
      [],
      parameterBindings
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      scope: 'parameter',
      action: 'setParameter',
      targetLabel: 'Scale',
      bindingLabel: 'Ch 1 / E2 (40)',
      behaviorLabel: 'Set 2 linked parameters over 0 to 4',
      parameterBindingId: 'parameter:clip-1:scale.x',
    });
    expect(result[1]).toMatchObject({
      scope: 'parameter',
      action: 'setParameter',
      targetLabel: 'Opacity',
      bindingLabel: 'Ch 2 / CC 74',
      behaviorLabel: 'Set parameter value over 0 to 1 (inverted, damped)',
      parameterBindingId: 'parameter:clip-1:opacity',
    });
  });
});
