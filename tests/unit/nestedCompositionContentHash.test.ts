import { describe, expect, it } from 'vitest';
import { createNestedContentHash, getCompositionContentDependents } from '../../src/stores/timeline/clip/nestedCompositionContentHash';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import type { CompositionTimelineData, SerializableClip } from '../../src/types';
import { MAX_NESTING_DEPTH } from '../../src/stores/timeline/constants';

function content(): CompositionTimelineData {
  const { file: _file, source: _source, ...clip } = createMockClip({ id: 'audio', trackId: 'a1' });
  return {
    duration: 60, tracks: [createMockTrack({ id: 'a1', type: 'audio' })],
    clips: [{ ...clip, mediaFileId: 'song', sourceType: 'audio' }],
    playheadPosition: 0, zoom: 50, scrollX: 0, inPoint: null, outPoint: null, loopPlayback: false,
  };
}

describe('nested composition content identity', () => {
  it.each([
    ['speed', { speed: 2, duration: 2.5 }],
    ['reverse', { reversed: true }],
    ['pitch mode', { preservesPitch: false }],
    ['source', { mediaFileId: 'replacement-song' }],
    ['audio mute', { audioState: { muted: true } }],
    ['speed automation', { keyframes: [createMockKeyframe({ property: 'speed', value: 2 })] }],
    ['effect settings', { effects: [{ id: 'gain', name: 'Gain', type: 'audio-volume', enabled: true, params: { volume: 0.2 } }] }],
  ] satisfies Array<[string, Partial<SerializableClip>]>)('invalidates %s changes while the composition duration stays fixed', (_name, patch) => {
    const before = content();
    const after = { ...before, clips: [{ ...before.clips[0], ...patch }] };
    expect(createNestedContentHash(after)).not.toBe(createNestedContentHash(before));
  });

  it('includes track mute and changed parameter values without requiring a new effect', () => {
    const before = content();
    before.clips[0].effects = [{ id: 'gain', name: 'Gain', type: 'audio-volume', enabled: true, params: { volume: 1 } }];
    const after = structuredClone(before);
    after.clips[0].effects[0].params.volume = 0.25;
    expect(createNestedContentHash(after)).not.toBe(createNestedContentHash(before));
    after.clips[0].effects[0].params.volume = 1;
    after.tracks[0].muted = true;
    expect(createNestedContentHash(after)).not.toBe(createNestedContentHash(before));
  });

  it('ignores navigation and generated waveform data', () => {
    const before = content();
    const after = structuredClone(before);
    after.playheadPosition = 22;
    after.zoom = 120;
    after.scrollX = 500;
    after.clips[0].waveform = [0, 1, 0];
    after.clips[0].thumbnails = ['blob:generated'];
    expect(createNestedContentHash(after)).toBe(createNestedContentHash(before));
  });

  it('invalidates ancestors when only a deeply nested source changes', () => {
    const child = content();
    const parent = content();
    parent.clips[0] = { ...parent.clips[0], isComposition: true, compositionId: 'child' };
    const compositions = [{ id: 'child', timelineData: child }, { id: 'parent', timelineData: parent }];
    const before = createNestedContentHash(parent, compositions);
    child.clips[0].speed = 0.5;
    expect(createNestedContentHash(parent, compositions)).not.toBe(before);
    expect([...getCompositionContentDependents('child', compositions)]).toEqual(['child', 'parent']);
  });

  it('terminates for malformed circular references', () => {
    const data = content();
    data.clips[0] = { ...data.clips[0], isComposition: true, compositionId: 'loop' };
    const compositions = [{ id: 'loop', timelineData: data }];
    const before = createNestedContentHash(data, compositions);
    expect(before).toMatch(/^nested-v2:[a-f0-9]{16}$/);
    data.clips[0].speed = 2;
    expect(createNestedContentHash(data, compositions)).not.toBe(before);
  });

  it('keeps shared-child DAG keys bounded and tracks a leaf edit', () => {
    const compositions = Array.from({ length: MAX_NESTING_DEPTH }, (_, index) => ({
      id: `composition-${index}`, timelineData: content(),
    }));
    let inspectedSourceClips = 0;
    compositions.forEach((composition, index) => {
      const data = composition.timelineData;
      if (index + 1 < compositions.length) {
        data.clips = Array.from({ length: 8 }, (_, instance) => ({
          ...data.clips[0], id: `instance-${instance}`, isComposition: true,
          compositionId: compositions[index + 1].id,
        }));
      }
      const clips = data.clips;
      Object.defineProperty(data, 'clips', { get: () => { inspectedSourceClips++; return clips; } });
    });
    const root = compositions[0].timelineData;
    const before = createNestedContentHash(root, compositions);
    expect(before).toMatch(/^nested-v2:[a-f0-9]{16}$/);
    expect(inspectedSourceClips).toBeLessThanOrEqual(MAX_NESTING_DEPTH * 3);
    compositions.at(-1)!.timelineData.clips[0].speed = 2;
    expect(createNestedContentHash(root, compositions.toReversed())).not.toBe(before);
  });

  it('does not traverse beyond the supported composition nesting depth', () => {
    const compositions = Array.from({ length: MAX_NESTING_DEPTH + 1 }, (_, index) => ({
      id: `composition-${index}`, timelineData: content(),
    }));
    compositions.forEach((composition, index) => {
      if (index + 1 === compositions.length) return;
      composition.timelineData.clips[0] = {
        ...composition.timelineData.clips[0], isComposition: true,
        compositionId: compositions[index + 1].id,
      };
    });
    const root = compositions[0].timelineData;
    const before = createNestedContentHash(root, compositions);
    compositions.at(-1)!.timelineData.clips[0].speed = 2;
    expect(createNestedContentHash(root, compositions)).toBe(before);
  });
});
