import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyPhoneFormat, capturePhoneFormatSnapshot } from '../../src/components/mobileSkin/format/phoneFormatSnapshot';
import { useMediaStore } from '../../src/stores/mediaStore';
import { createCompositionCrudActions } from '../../src/stores/mediaStore/slices/composition/crudActions';
import type { Composition, MediaState } from '../../src/stores/mediaStore/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

// The format sheet resizes from its session-start snapshot on every tap, so stepping between
// presets and layouts is exact. The global test setup mocks useMediaStore; the real crud actions
// run on a small local state behind it.

const originalTimeline = useTimelineStore.getState();
let media: MediaState;

function mediaState(): MediaState {
  return {
    ...media,
    ...createCompositionCrudActions(
      (update: unknown) => {
        const patch = typeof update === 'function' ? (update as (state: MediaState) => Partial<MediaState>)(media) : update as Partial<MediaState>;
        media = { ...media, ...patch };
      },
      () => media,
      {} as never,
    ),
  } as MediaState;
}

function setup(): void {
  const comp = { id: 'comp', name: 'Comp', type: 'composition', width: 1080, height: 1920, frameRate: 30, duration: 60, backgroundColor: '#000000', parentId: null, createdAt: 0 } as Composition;
  media = { compositions: [comp], files: [], activeCompositionId: 'comp', openCompositionIds: ['comp'] } as unknown as MediaState;
  vi.mocked(useMediaStore.getState).mockImplementation(mediaState);
  const transform = { opacity: 1, blendMode: 'normal' as const, position: { x: 0.2, y: -0.4, z: 0 }, scale: { all: 1.1, x: 0.7, y: 0.7 }, rotation: { x: 0, y: 0, z: 0 } };
  useTimelineStore.setState({
    tracks: [createMockTrack({ id: 't', type: 'video' })],
    // A title whose raster is gone (as after a history restore) has no known size at all.
    clips: [{ ...createMockClip({ id: 'title', trackId: 't', transform }), source: { type: 'text' } }],
    clipKeyframes: new Map([['title', [
      { id: 'kx', clipId: 'title', time: 0, property: 'position.x', value: 0.2, easing: 'linear' },
      { id: 'ks', clipId: 'title', time: 1, property: 'scale.y', value: 0.7, easing: 'linear' },
      { id: 'ko', clipId: 'title', time: 1, property: 'opacity', value: 0.5, easing: 'linear' },
    ]]]),
  } as never);
}

describe('phone format snapshot', () => {
  afterEach(() => {
    useTimelineStore.setState(originalTimeline, true);
    vi.mocked(useMediaStore.getState).mockReset();
  });

  it('9:16 -> 16:9 -> 1:1 -> layout switch -> 9:16 ends exactly where it started', () => {
    setup();
    const before = structuredClone({ clips: useTimelineStore.getState().clips.map((clip) => clip.transform), keys: useTimelineStore.getState().clipKeyframes.get('title') });
    const snapshot = capturePhoneFormatSnapshot()!;
    expect(snapshot.size).toEqual({ width: 1080, height: 1920 });

    applyPhoneFormat(snapshot, { width: 1920, height: 1080 }, 'relative');
    expect(media.compositions[0]).toMatchObject({ width: 1920, height: 1080 });
    applyPhoneFormat(snapshot, { width: 1080, height: 1080 }, 'relative');
    const square = useTimelineStore.getState().clips[0].transform.scale.x;
    expect(square).toBeCloseTo(0.7 * Math.sqrt(1080 / 1920), 9);
    applyPhoneFormat(snapshot, { width: 1080, height: 1080 }, 'pixels');
    expect(useTimelineStore.getState().clips[0].transform.scale.x).toBe(0.7);
    applyPhoneFormat(snapshot, { width: 1920, height: 1080 }, 'relative');
    applyPhoneFormat(snapshot, { width: 1080, height: 1920 }, 'relative');

    expect(media.compositions[0]).toMatchObject({ width: 1080, height: 1920 });
    expect(useTimelineStore.getState().clips.map((clip) => clip.transform)).toEqual(before.clips);
    expect(useTimelineStore.getState().clipKeyframes.get('title')).toEqual(before.keys);
  });

  it('each tap resizes once from the snapshot, never from the previous preset', () => {
    setup();
    const snapshot = capturePhoneFormatSnapshot()!;
    applyPhoneFormat(snapshot, { width: 1080, height: 1080 }, 'relative');
    applyPhoneFormat(snapshot, { width: 2520, height: 1080 }, 'relative');
    const viaSquare = useTimelineStore.getState().clips[0].transform;
    setup();
    applyPhoneFormat(capturePhoneFormatSnapshot()!, { width: 2520, height: 1080 }, 'relative');
    expect(useTimelineStore.getState().clips[0].transform).toEqual(viaSquare);
  });

  it('refuses to write when another composition became active', () => {
    setup();
    const snapshot = capturePhoneFormatSnapshot()!;
    media = { ...media, activeCompositionId: 'other' };
    expect(() => applyPhoneFormat(snapshot, { width: 1920, height: 1080 }, 'relative')).toThrow(/Another composition/);
  });
});
