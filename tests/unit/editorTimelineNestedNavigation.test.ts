import { expect, it, vi } from 'vitest';
import type { Composition, MediaState } from '../../src/stores/mediaStore/types';
import type { SerializableClip, TimelineClip, TimelineStore } from '../../src/stores/timeline/types';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { stageEditorTimeline } from '../../src/services/project/repository/transaction/editorTimelineRestore';

function fixture(activeDepth: number, cyclic = false) {
  const clip = (depth: number): SerializableClip => ({
    id: `clip-${depth}`, trackId: 'video', name: `Level ${depth}`, mediaFileId: '',
    startTime: 0, duration: 12, inPoint: 0, outPoint: 12,
    transform: DEFAULT_TRANSFORM, effects: [],
    ...(depth === 0 && !cyclic ? { sourceType: 'solid', solidColor: '#ff0000' }
      : { sourceType: 'video', isComposition: true, compositionId: `comp-${depth === 0 ? 5 : depth - 1}` }),
  });
  const compositions = Array.from({ length: 6 }, (_, depth) => ({
    id: `comp-${depth}`, name: `Level ${depth}`, type: 'composition',
    width: 64, height: 36, frameRate: 30, duration: 12,
    timelineData: { tracks: [{ id: 'video', name: 'Video', type: 'video', visible: true }],
      clips: [clip(depth)], duration: 12 },
  })) as Composition[];
  const media = { activeCompositionId: `comp-${activeDepth}`, compositions, files: [] } as unknown as MediaState;
  const current = { timelineSessionId: 1, clips: [], selectedClipIds: new Set(),
    selectedKeyframeIds: new Set(), clipKeyframes: new Map(), thumbnailsEnabled: false } as unknown as TimelineStore;
  return { media, current, destination: compositions[5] };
}

it.each([0, 1, 3, 4])('restores all five nested levels when returning from child %i', async (depth) => {
  const { current, media, destination } = fixture(depth);
  const staged = await stageEditorTimeline(current, media, destination, new AbortController().signal, vi.fn(), () => current);
  let clips = staged.state.clips!;
  for (let level = 5; level > 0; level--) {
    expect(clips).toHaveLength(1);
    expect(clips[0].compositionId).toBe(`comp-${level - 1}`);
    clips = clips[0].nestedClips!;
  }
  expect(clips).toHaveLength(1);
  expect(clips[0]).toMatchObject({ solidColor: '#ff0000', source: { type: 'solid' } });
  expect(media.activeCompositionId).toBe(`comp-${depth}`);
  expect(current.clips).toEqual([]);
  staged.abandon();
});

it('still stops a real cycle back to the destination composition', async () => {
  const { current, media, destination } = fixture(0, true);
  const staged = await stageEditorTimeline(current, media, destination, new AbortController().signal, vi.fn(), () => current);
  const flatten = (clips: TimelineClip[]): TimelineClip[] => clips.flatMap(clip => [clip, ...flatten(clip.nestedClips ?? [])]);
  const restored = flatten(staged.state.clips!);
  expect(restored).toHaveLength(6);
  expect(restored.at(-1)).toMatchObject({ compositionId: 'comp-5', nestedClips: [] });
  staged.abandon();
});
