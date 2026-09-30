import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Composition } from '../../src/stores/mediaStore';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';

const transform = { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, opacity: 1, anchor: { x: 0, y: 0, z: 0 } };

function track(id: string, type: 'video' | 'audio' = 'video'): TimelineTrack {
  return { id, name: id.toUpperCase(), type, height: 60, muted: false, visible: true, solo: false } as TimelineTrack;
}

function clip(id: string, trackId: string, startTime: number, duration: number, type: 'video' | 'audio' = 'video'): TimelineClip {
  return {
    id, trackId, name: id, file: new File(['x'], `${id}.mxf`), startTime, duration, inPoint: 0, outPoint: duration,
    mediaFileId: `media-${id}`, source: { type, mediaFileId: `media-${id}`, naturalDuration: duration },
    transform, effects: [],
  } as unknown as TimelineClip;
}

function programOf(trackId: string): Array<[number, number]> {
  return useTimelineStore.getState().clips
    .filter((candidate) => candidate.trackId === trackId)
    .map((candidate) => [candidate.startTime, candidate.startTime + candidate.duration] as [number, number])
    .toSorted((a, b) => a[0] - b[0]);
}

// The media store is mocked globally (tests/setup.ts); back it with a mutable state.
let mediaState: { files: unknown[]; compositions: Composition[]; activeCompositionId: string; updateComposition: (id: string, updates: Partial<Composition>) => void };

describe('multicam store actions', () => {
  beforeEach(() => {
    mediaRuntimeRegistry.clear();
    const originals = [clip('jonas', 'jonas', 100, 400), clip('total', 'total', 50, 900), clip('stem', 'mix', 110, 800, 'audio')];
    mediaState = {
      files: originals.map((original) => ({
        id: `media-${original.id}`, name: `${original.id}.mxf`, type: original.source!.type, file: original.file,
        duration: original.duration, url: '',
      })) as never,
      compositions: [{ id: 'show', name: 'Show', type: 'composition', width: 3840, height: 2160, frameRate: 25, duration: 1000, backgroundColor: '#000' }] as never,
      activeCompositionId: 'show',
      updateComposition: (id, updates) => {
        mediaState.compositions = mediaState.compositions.map((comp) => (comp.id === id ? { ...comp, ...updates } : comp));
      },
    };
    vi.mocked(useMediaStore.getState).mockImplementation(() => mediaState as never);
    useTimelineStore.setState({
      tracks: [track('jonas'), track('total'), track('mix', 'audio')],
      clips: originals,
      selectedClipIds: new Set(),
      playheadPosition: 250,
      isPlaying: false,
    });
  });

  it('keeps the topmost camera, links every clip and stores the angles on the composition', () => {
    expect(useTimelineStore.getState().enableMulticam()).toBe(true);
    const multicam = mediaState.compositions[0]!.multicam!;
    expect(multicam.active).toBe(true);
    expect(multicam.angles.map((angle) => angle.trackId)).toEqual(['jonas', 'total']);
    expect(programOf('jonas')).toEqual([[100, 500]]);
    expect(programOf('total')).toEqual([[50, 100], [500, 950]]);
    expect(new Set(useTimelineStore.getState().clips.map((candidate) => candidate.linkedGroupId))).toEqual(new Set([multicam.groupId]));
  });

  it('switches the segment under the paused playhead and cuts at the playhead while playing', () => {
    useTimelineStore.getState().enableMulticam();
    expect(useTimelineStore.getState().switchMulticamAngle(1, 'segment')).toBe(true);
    expect(programOf('jonas')).toEqual([]);
    expect(programOf('total')).toEqual([[50, 100], [100, 500], [500, 950]]);

    useTimelineStore.setState({ playheadPosition: 300 });
    expect(useTimelineStore.getState().switchMulticamAngle(0, 'cut')).toBe(true);
    expect(programOf('jonas')).toEqual([[300, 500]]);
    expect(programOf('total')).toEqual([[50, 100], [100, 300], [500, 950]]);
    const cutPiece = useTimelineStore.getState().clips.find((candidate) => candidate.trackId === 'jonas')!;
    expect(cutPiece).toMatchObject({ inPoint: 200, outPoint: 400, mediaFileId: 'media-jonas' });
  });

  it('leaves the program alone for a camera without material or already on air', () => {
    useTimelineStore.getState().enableMulticam();
    const before = programOf('total');
    useTimelineStore.setState({ playheadPosition: 700 });
    expect(useTimelineStore.getState().switchMulticamAngle(0, 'segment')).toBe(false);
    expect(useTimelineStore.getState().switchMulticamAngle(1, 'segment')).toBe(false);
    expect(programOf('total')).toEqual(before);
  });

  it('turns cut mode off and back on without rebuilding the program', () => {
    useTimelineStore.getState().enableMulticam();
    const clipIds = useTimelineStore.getState().clips.map((candidate) => candidate.id);
    useTimelineStore.getState().setMulticamActive(false);
    expect(mediaState.compositions[0]!.multicam!.active).toBe(false);
    useTimelineStore.getState().setMulticamActive(true);
    expect(mediaState.compositions[0]!.multicam!.active).toBe(true);
    expect(useTimelineStore.getState().clips.map((candidate) => candidate.id)).toEqual(clipIds);
  });
});
