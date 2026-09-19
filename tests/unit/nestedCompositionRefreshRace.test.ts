import { afterEach, expect, it, vi } from 'vitest';
import { loadNestedClips } from '../../src/stores/timeline/nestedCompositionLoader';
import * as textRestore from '../../src/stores/timeline/nestedComposition/nestedCompositionTextClip';
import { generateNestedClipId } from '../../src/stores/timeline/helpers/idGenerator';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import type { Composition, MediaFile } from '../../src/stores/mediaStore/types';
import type { CompositionTimelineData, SerializableClip } from '../../src/types/timeline';
import type { Keyframe } from '../../src/types/keyframes';

afterEach(() => vi.restoreAllMocks());

it('does not restore an old sub-nested image after a newer refresh finishes during an await', async () => {
  const track = createMockTrack({ id: 'v1', type: 'video' });
  const { source: _source, file: _file, ...base } = createMockClip({ trackId: track.id });
  const image: SerializableClip = { ...base, id: 'image', sourceType: 'image', mediaFileId: 'old-image' };
  const child = {
    id: 'child', name: 'Child', duration: 10, width: 1920, height: 1080,
    timelineData: { clips: [image], tracks: [track], duration: 10 } as CompositionTimelineData,
  } as Composition;
  const nestedReference: SerializableClip = {
    ...base, id: 'child-instance', sourceType: 'video', mediaFileId: '',
    isComposition: true, compositionId: child.id,
  };
  const parent = {
    ...child, id: 'parent', timelineData: { ...child.timelineData!, clips: [nestedReference] },
  };
  const nestedId = generateNestedClipId('root', nestedReference.id);
  const newerImage = createMockClip({
    id: generateNestedClipId(nestedId, image.id),
    source: { type: 'image', naturalDuration: 10, imageUrl: 'blob:new-image' },
  });
  const state = {
    tracks: [track], thumbnailsEnabled: false,
    clips: [createMockClip({ id: 'root', isComposition: true, compositionId: parent.id, nestedClips: [
      createMockClip({ id: nestedId, isComposition: true, compositionId: child.id, nestedClips: [newerImage] }),
    ] })],
    clipKeyframes: new Map<string, Keyframe[]>(), invalidateCache: vi.fn(),
  };
  let current = true;
  let resumeRestore!: (value: boolean) => void;
  let signalStarted!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const pausedRestore = new Promise<boolean>(resolve => { resumeRestore = resolve; });
  vi.spyOn(textRestore, 'appendNestedTextClip').mockImplementationOnce(() => {
    signalStarted();
    return pausedRestore;
  });
  const createObjectURL = vi.spyOn(URL, 'createObjectURL');
  const set = vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch));
  const restore = loadNestedClips({
    compClipId: 'root', composition: parent, get: () => state, set,
    isCurrentTimelineSession: () => current,
    getMediaState: () => ({
      files: [{ id: 'old-image', name: 'old.png', type: 'image', duration: 10,
        file: new File(['old'], 'old.png', { type: 'image/png' }),
      } as MediaFile],
      compositions: [parent, child],
    }),
  });
  await started;
  current = false;
  resumeRestore(false);
  await restore;
  expect(state.clips[0].nestedClips?.[0].nestedClips?.[0]).toBe(newerImage);
  expect(newerImage.source?.imageUrl).toBe('blob:new-image');
  expect(set).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
});
