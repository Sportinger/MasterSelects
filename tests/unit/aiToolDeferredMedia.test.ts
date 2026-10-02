import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferLinkedMedia, finishLinkedMediaDemand } from '../../src/services/project/linkedMediaDemand';
import { handleAddClipSegment } from '../../src/services/aiTools/handlers/clips/addSegment';

const stores = vi.hoisted(() => ({
  media: { files: [] as Array<{ id: string; type: string; file: File | null }> },
  timeline: {
    tracks: [{ id: 'audio-1', type: 'audio' }],
    clips: [] as Array<Record<string, unknown>>,
    addClip: vi.fn(),
  },
}));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => stores.media } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => stores.timeline } }));
vi.mock('../../src/stores/timeline/revisionMiddleware', () => ({ getTimelineRevision: () => 0 }));

const args = { mediaFileId: 'saved-audio', trackId: 'audio-1', startTime: 0, inPoint: 0, outPoint: 1, deClickFadeSeconds: 0 };

beforeEach(() => {
  stores.media.files = [{ id: 'saved-audio', type: 'audio', file: null }];
  stores.timeline.clips = [];
  stores.timeline.addClip.mockReset();
});

describe('atomic clip insertion with deferred project media', () => {
  it('opens the requested source before inserting a clip and leaves unrelated media unopened', async () => {
    const source = new File(['audio'], 'saved.wav');
    const open = vi.fn(async (id: string) => {
      stores.media.files = [{ id, type: 'audio', file: source }];
      finishLinkedMediaDemand(id);
      return true;
    });
    deferLinkedMedia(['saved-audio', 'unused-audio'], open);
    stores.timeline.addClip.mockImplementation(async () => {
      stores.timeline.clips = [{
        id: 'new-clip', trackId: 'audio-1', startTime: 0, duration: 1,
        inPoint: 0, outPoint: 1, transform: { scale: { x: 1, y: 1 } },
      }];
    });

    expect((await handleAddClipSegment(args)).success).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith('saved-audio');
    expect(stores.timeline.addClip).toHaveBeenCalledWith('audio-1', source, 0, 1, 'saved-audio', undefined, undefined);
  });

  it('does not mutate the timeline when the saved source cannot be opened', async () => {
    deferLinkedMedia(['saved-audio'], async () => false);
    expect((await handleAddClipSegment(args)).success).toBe(false);
    expect(stores.timeline.addClip).not.toHaveBeenCalled();
  });
});
