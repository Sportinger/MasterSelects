import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { isRepositoryHydrating } from '../../src/services/project/repository/transaction/storeMutationBoundary';
import { restoreLinkedTimelineMedia } from '../../src/services/project/repository/transaction/restoreLinkedTimelineMedia';

const data = vi.hoisted(() => ({ state: { clips: [] as TimelineClip[], tracks: [] as unknown[] }, set: vi.fn() }));
vi.mock('../../src/services/project/repository/transaction/storeMutationBoundary', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/project/repository/transaction/storeMutationBoundary')>(),
  getRepositoryStore: () => ({ getState: () => data.state, setState: data.set }),
}));
vi.mock('../../src/services/layerBuilder', () => ({ layerBuilder: { invalidateCache: vi.fn() } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestNewFrameRender: vi.fn() } }));
vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({
  bindRuntimeToClip: (clip: TimelineClip) => ({ ...clip, source: { ...clip.source, runtimeSourceId: 'media:original' } }),
}));
beforeEach(() => {
  data.set.mockReset();
  data.set.mockImplementation(patch => {
    expect(isRepositoryHydrating()).toBe(true);
    data.state = { ...data.state, ...patch };
  });
});
const offline = (id: string) => ({ id, trackId: 'locked', needsReload: true,
  source: { type: 'audio', mediaFileId: 'original', naturalDuration: 12 },
  audioState: { sourceAudioRevisionId: 'keep-revision', sourceAnalysisRefs: { waveform: 'keep-waveform' } },
} as unknown as TimelineClip);
describe('linked original restoration', () => {
  it('leaves extracted audio offline if a linked video has no audio stream', () => {
    const clip = offline('silent-video-audio');
    data.state = { clips: [clip], tracks: [{ id: 'locked', type: 'audio' }] };
    restoreLinkedTimelineMedia('original', new File(['silent'], 'silent.mov'), 'blob:silent', { type: 'video', hasAudio: false });
    expect(data.state.clips[0]).toBe(clip);
    expect(data.set).not.toHaveBeenCalled();
  });
  it('restores locked and nested clips in one runtime patch without erasing audio analysis', () => {
    const root = offline('root'), child = offline('nested');
    const unrelated = { ...offline('other'), source: { ...root.source!, mediaFileId: 'other' } };
    data.state = { clips: [root, { id: 'comp', nestedClips: [child] } as TimelineClip, unrelated],
      tracks: [{ id: 'locked', type: 'audio', locked: true }] };
    const file = new File(['original'], 'original.wav');
    restoreLinkedTimelineMedia('original', file, 'blob:original');
    expect(data.set).toHaveBeenCalledTimes(1);
    for (const [clip, original] of [[data.state.clips[0], root], [data.state.clips[1].nestedClips![0], child]]) {
      expect(clip.file).toBe(file);
      expect(clip.needsReload).toBe(false);
      expect(clip.audioState).toBe(original.audioState);
      expect(clip.audioState?.sourceAudioRevisionId).toBe('keep-revision');
      expect(clip.source?.naturalDuration).toBe(12);
    }
    expect(data.state.clips[2]).toBe(unrelated);
    restoreLinkedTimelineMedia('original', file, 'blob:original');
    expect(data.set).toHaveBeenCalledTimes(1);
  });
});
