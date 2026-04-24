import { describe, expect, it } from 'vitest';
import { collectMIDIMappingSummary } from '../../src/services/midi/midiMappingSummary';
import type { TimelineMarker } from '../../src/stores/timeline/types';

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
});
