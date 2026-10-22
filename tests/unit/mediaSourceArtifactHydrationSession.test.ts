import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  open: false,
  publication: {} as object,
  media: { files: [] as Array<Record<string, unknown>> },
  getTranscript: vi.fn(),
}));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: {
  getState: () => state.media,
  setState: (update: (current: typeof state.media) => Partial<typeof state.media>) => {
    Object.assign(state.media, update(state.media));
  },
} }));
vi.mock('../../src/services/projectFileService', () => ({ projectFileService: {
  isProjectOpen: () => state.open,
  getTranscript: state.getTranscript,
  getAllAnalysisMerged: async () => null,
  getAnalysisRanges: async () => [],
  getSceneDescriptions: async () => null,
} }));
vi.mock('../../src/services/project/repository/artifacts/RepositoryDomainPublication', () => ({
  captureRepositoryDomainPublication: () => state.publication,
}));
vi.mock('../../src/services/faceAnalysis/faceAnalysisPersistence', () => ({ restoreCachedClipAnalysis: () => null }));
import { hydrateMediaSourceArtifacts } from '../../src/services/mediaArtifacts/mediaSourceArtifacts';

const words = [{ id: 'word', text: 'Restored', start: 1, end: 2 }];
beforeEach(() => {
  state.open = false;
  state.publication = {};
  state.media = { files: [{ id: 'same-id', duration: 10, transcriptStatus: 'none' }] };
  state.getTranscript.mockReset();
  state.getTranscript.mockResolvedValue({ words });
});

describe('source artifact hydration across repository activation', () => {
  it('does not cache an empty lookup before the project has opened', async () => {
    await hydrateMediaSourceArtifacts('same-id');
    expect(state.getTranscript).not.toHaveBeenCalled();
    state.open = true;
    expect((await hydrateMediaSourceArtifacts('same-id'))?.transcript).toEqual(words);
  });

  it('rehydrates identical media IDs when opening another repository session', async () => {
    state.open = true;
    state.getTranscript.mockResolvedValueOnce(null);
    await hydrateMediaSourceArtifacts('same-id');
    state.publication = {};
    state.media = { files: [{ id: 'same-id', duration: 10, transcriptStatus: 'none' }] };
    expect((await hydrateMediaSourceArtifacts('same-id'))?.transcript).toEqual(words);
    expect(state.getTranscript).toHaveBeenCalledTimes(2);
  });

  it('discards a late read from the old project without caching or overwriting the new one', async () => {
    state.open = true;
    let finish!: (value: unknown) => void;
    state.getTranscript.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = hydrateMediaSourceArtifacts('same-id');
    state.publication = {};
    state.media = { files: [{ id: 'same-id', duration: 10, transcriptStatus: 'none' }] };
    const current = await hydrateMediaSourceArtifacts('same-id');
    finish({ words: [{ ...words[0], text: 'Wrong project' }] });
    expect(await old).toBeUndefined();
    expect(current?.transcript).toEqual(words);
    expect(state.media.files[0].transcript).toEqual(words);
    await hydrateMediaSourceArtifacts('same-id');
    expect(state.getTranscript).toHaveBeenCalledTimes(2);
  });
});
