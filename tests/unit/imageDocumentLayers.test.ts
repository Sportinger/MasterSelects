import { describe, expect, it } from 'vitest';
import { findReusableTopLayerTrack, getImageLayers } from '../../src/services/imageDocument/imageLayers';
import type { TimelineTrack } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

function track(id: string, type: TimelineTrack['type'] = 'video', extra: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id, name: id, type, height: 60, muted: false, visible: true, solo: false, ...extra };
}

describe('image document layers', () => {
  const tracks = [track('v3'), track('v2'), track('v1'), track('a1', 'audio')];

  it('lists the first clip of each video track top to bottom in a still document', () => {
    const clips = [
      createMockClip({ id: 'bg', trackId: 'v1', startTime: 0, duration: 5 }),
      createMockClip({ id: 'logo', trackId: 'v3', startTime: 0, duration: 5 }),
      createMockClip({ id: 'music', trackId: 'a1', startTime: 0, duration: 5 }),
    ];
    const layers = getImageLayers(tracks, clips, { still: true, time: 99 });
    expect(layers.map((layer) => layer.clip.id)).toEqual(['logo', 'bg']);
  });

  it('lists the clips under the playhead in a video composition', () => {
    const clips = [
      createMockClip({ id: 'early', trackId: 'v2', startTime: 0, duration: 2 }),
      createMockClip({ id: 'late', trackId: 'v2', startTime: 2, duration: 2 }),
      createMockClip({ id: 'base', trackId: 'v1', startTime: 0, duration: 10 }),
    ];
    expect(getImageLayers(tracks, clips, { still: false, time: 2.5 }).map((layer) => layer.clip.id))
      .toEqual(['late', 'base']);
    expect(getImageLayers(tracks, clips, { still: false, time: 12 })).toEqual([]);
  });

  it('reuses the empty track directly above the occupied ones for a new top layer', () => {
    const clips = [createMockClip({ id: 'bg', trackId: 'v1' })];
    expect(findReusableTopLayerTrack(tracks, clips)?.id).toBe('v2');
    expect(findReusableTopLayerTrack(tracks, [createMockClip({ id: 'top', trackId: 'v3' })])).toBeNull();
    expect(findReusableTopLayerTrack(tracks, [])?.id).toBe('v1');
  });

  it('never reuses a locked track', () => {
    const lockedTracks = [track('v2', 'video', { locked: true }), track('v1')];
    expect(findReusableTopLayerTrack(lockedTracks, [createMockClip({ id: 'bg', trackId: 'v1' })])).toBeNull();
  });
});
