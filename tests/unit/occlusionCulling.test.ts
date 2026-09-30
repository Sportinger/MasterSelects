import { afterEach, describe, expect, it } from 'vitest';
import {
  computeRenderVisibleVideoTrackIds,
  setOcclusionCullingEnabled,
} from '../../src/services/layerBuilder/occlusionCulling';
import type { TimelineClip, TimelineTrack } from '../../src/types';

const FRAME = { width: 3840, height: 2160 };

function track(id: string, visible = true): TimelineTrack {
  return { id, name: id, type: 'video', visible, muted: false, solo: false, height: 40, locked: false } as TimelineTrack;
}

function videoClip(id: string, trackId: string, startTime: number, duration: number, extra: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, trackId, name: id, startTime, duration, inPoint: 0, outPoint: duration,
    source: { type: 'video', mediaFileId: 'hd' },
    transform: {
      opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2 }, rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    ...extra,
  } as TimelineClip;
}

function compClip(id: string, trackId: string, nestedClips: TimelineClip[], nestedTracks: TimelineTrack[]): TimelineClip {
  return videoClip(id, trackId, 0, 10000, {
    isComposition: true, compositionId: 'sub', nestedClips, nestedTracks,
    transform: {
      opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, anchor: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 },
    },
  });
}

function context(clips: TimelineClip[], tracks: TimelineTrack[], playheadPosition: number, keyframed: string[] = []) {
  return {
    clips,
    videoTracks: tracks,
    visibleVideoTrackIds: new Set(tracks.filter((t) => t.visible).map((t) => t.id)),
    playheadPosition,
    isPlaying: true,
    playbackSpeed: 1,
    mediaFileById: new Map([
      ['hd', { id: 'hd', width: 1920, height: 1080, canBeTransparent: false }],
      ['alpha', { id: 'alpha', width: 3840, height: 2160, canBeTransparent: true }],
    ]) as never,
    compositionById: new Map([['sub', { id: 'sub', width: 3840, height: 2160 }]]) as never,
    hasKeyframes: (clipId: string) => keyframed.includes(clipId),
  };
}

const ids = (set: Set<string>) => [...set].sort();

describe('occlusion culling', () => {
  afterEach(() => setOcclusionCullingEnabled(true));

  it('drops tracks beneath a lasting opaque full-frame clip', () => {
    const tracks = [track('top'), track('mid'), track('low')];
    const clips = [videoClip('a', 'top', 0, 100), videoClip('b', 'mid', 0, 100), videoClip('c', 'low', 0, 100)];
    expect(ids(computeRenderVisibleVideoTrackIds(context(clips, tracks, 10), FRAME))).toEqual(['top']);
  });

  it('keeps lower tracks when the top clip ends inside the lookahead window', () => {
    const tracks = [track('top'), track('low')];
    const clips = [videoClip('a', 'top', 0, 11), videoClip('c', 'low', 0, 100)];
    expect(ids(computeRenderVisibleVideoTrackIds(context(clips, tracks, 10), FRAME))).toEqual(['low', 'top']);
  });

  it('hands coverage over across back-to-back pieces', () => {
    const tracks = [track('top'), track('low')];
    const clips = [videoClip('a1', 'top', 0, 10.5), videoClip('a2', 'top', 10.5, 300), videoClip('c', 'low', 0, 100)];
    expect(ids(computeRenderVisibleVideoTrackIds(context(clips, tracks, 10), FRAME))).toEqual(['top']);
  });

  it('never culls beneath translucent, blended, masked, keyframed, undersized or alpha clips', () => {
    const tracks = [track('top'), track('low')];
    const low = videoClip('c', 'low', 0, 100);
    const variants: Array<[Partial<TimelineClip>, string[]]> = [
      [{ transform: { ...videoClip('x', 'top', 0, 1).transform, opacity: 0.99 } }, []],
      [{ transform: { ...videoClip('x', 'top', 0, 1).transform, blendMode: 'screen' } }, []],
      [{ transform: { ...videoClip('x', 'top', 0, 1).transform, scale: { x: 1, y: 1 } } }, []],
      [{ transform: { ...videoClip('x', 'top', 0, 1).transform, rotation: { x: 0, y: 0, z: 180 } } }, []],
      [{ masks: [{ id: 'm' }] as never }, []],
      [{ effects: [{ id: 'e', enabled: true }] as never }, []],
      [{ source: { type: 'video', mediaFileId: 'alpha' } as never }, []],
      [{}, ['a']],
    ];
    for (const [extra, keyframed] of variants) {
      const top = videoClip('a', 'top', 0, 100, extra);
      expect(ids(computeRenderVisibleVideoTrackIds(context([top, low], tracks, 10, keyframed), FRAME))).toEqual(['low', 'top']);
    }
  });

  it('looks into nested compositions, ignoring hidden nested tracks and stopping at gaps', () => {
    const tracks = [track('camA'), track('camB')];
    const inner = [track('proxy'), track('original', false)];
    const pieces = [videoClip('p1', 'proxy', 0, 300), videoClip('p2', 'proxy', 300, 300), videoClip('mxf', 'original', 0, 600)];
    const clips = [compClip('A', 'camA', pieces, inner), compClip('B', 'camB', pieces, inner)];
    expect(ids(computeRenderVisibleVideoTrackIds(context(clips, tracks, 299), FRAME))).toEqual(['camA']);
    // The nested pieces end at 600 s: close to that gap camera B must stay alive.
    expect(ids(computeRenderVisibleVideoTrackIds(context(clips, tracks, 599), FRAME))).toEqual(['camA', 'camB']);
  });

  it('can be switched off', () => {
    const tracks = [track('top'), track('low')];
    const clips = [videoClip('a', 'top', 0, 100), videoClip('c', 'low', 0, 100)];
    setOcclusionCullingEnabled(false);
    expect(ids(computeRenderVisibleVideoTrackIds(context(clips, tracks, 10), FRAME))).toEqual(['low', 'top']);
  });
});
