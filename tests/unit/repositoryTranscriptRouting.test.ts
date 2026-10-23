import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTranscript, getTranscribedRanges, saveTranscript, deleteTranscript } from '../../src/services/project/fileService/artifactStorageDelegates';
import type { ArtifactStorageContext } from '../../src/services/project/fileService/artifactStorageDelegates';
import { setRepositoryDomainPublication, type RepositoryDomainPublication } from '../../src/services/project/repository/artifacts/RepositoryDomainPublication';

afterEach(() => { setRepositoryDomainPublication(null); });
describe('transcripts in repository-backed projects', () => {
  it('reads, updates and deletes through the active repository without requiring a legacy folder handle', async () => {
    let stored: string | null = JSON.stringify({ words: [{ text: 'Bonjour' }], transcribedRanges: [[0, 20]] });
    const readFile = vi.fn(async () => stored === null ? null : { text: async () => stored });
    const writeFile = vi.fn(async (_folder, _name, value) => { stored = value; return true; });
    const deleteFile = vi.fn(async () => { stored = null; return true; });
    setRepositoryDomainPublication({ readFile, writeFile, deleteFile } as unknown as RepositoryDomainPublication);
    const getProjectHandle = vi.fn(() => null);
    const context = { activeBackend: 'fsa', getProjectHandle } as unknown as ArtifactStorageContext;
    expect((await getTranscript(context, 'media'))?.words).toEqual([{ text: 'Bonjour' }]);
    expect(await saveTranscript(context, 'media', [{ text: 'Hello' }])).toBe(true);
    expect(await getTranscribedRanges(context, 'media')).toEqual([[0, 20]]);
    expect((await getTranscript(context, 'media'))?.words).toEqual([{ text: 'Hello' }]);
    expect(await deleteTranscript(context, 'media')).toBe(true);
    expect(await getTranscript(context, 'media')).toBeNull();
    expect(getProjectHandle).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith('TRANSCRIPTS', 'media.json', expect.any(String));
    expect(deleteFile).toHaveBeenCalledWith('TRANSCRIPTS', 'media.json');
  });
});
