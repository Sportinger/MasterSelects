import { describe, expect, it } from 'vitest';
import {
  collectAudioEqInstances,
  createAudioEqParamsForPresetKind,
  filterAudioEqInstances,
  findAudioEqInstance,
} from '../../../src/engine/audio';
import type { MasterAudioState, TimelineClip, TimelineTrack } from '../../../src/types';

describe('audio eq instance registry', () => {
  it('collects clip, track, master, and legacy eq instances into searchable descriptors', () => {
    const params = createAudioEqParamsForPresetKind('parametric');
    const clip = {
      id: 'clip-a',
      name: 'Voice Clip',
      audioState: {
        effectStack: [{
          id: 'clip-eq',
          descriptorId: 'audio-eq',
          enabled: true,
          params,
        }],
      },
      effects: [{
        id: 'legacy-eq',
        type: 'audio-eq',
        enabled: true,
        params: { band1k: 3 },
      }],
    } as TimelineClip;
    const track = {
      id: 'track-a',
      name: 'Dialogue',
      type: 'audio',
      audioState: {
        effectStack: [{
          id: 'track-eq',
          descriptorId: 'audio-eq',
          enabled: false,
          params,
        }],
      },
    } as TimelineTrack;
    const masterAudioState: MasterAudioState = {
      volumeDb: 0,
      limiterEnabled: false,
      truePeakCeilingDb: -1,
      effectStack: [{
        id: 'master-eq',
        descriptorId: 'audio-eq',
        enabled: true,
        params,
      }],
    };

    const instances = collectAudioEqInstances({ clips: [clip], tracks: [track], masterAudioState });

    expect(instances).toHaveLength(4);
    expect(instances.map(instance => instance.id)).toEqual([
      'clip:clip-a:clip-eq',
      'clip:clip-a:legacy-eq',
      'track:track-a:track-eq',
      'master:master:master-eq',
    ]);
    expect(filterAudioEqInstances(instances, { query: 'dialogue' })).toHaveLength(1);
    expect(filterAudioEqInstances(instances, { scope: 'clip' })).toHaveLength(2);
    expect(findAudioEqInstance(instances, 'master:master:master-eq')?.ownerName).toBe('Master');
  });
});
