import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { ArtifactStore } from '../../src/artifacts/ArtifactStore';
import { MemoryArtifactStorageAdapter } from '../../src/artifacts/memoryStorageAdapter';
import { createRepositoryDomainPublication } from '../../src/services/project/repository/artifacts/createRepositoryDomainPublication';
import { ProjectTransactionCoordinator, type CoordinatorStorage } from '../../src/services/project/repository/transaction/ProjectTransactionCoordinator';
import type { EntityDTO } from '../../src/services/project/repository/contracts';

vi.mock('../../src/services/project/repository/artifacts/WorkerRepositoryArtifactStore', () => ({
  getWorkerArtifactManifestReference: vi.fn(async () => ({
    hash: `sha256:${'a'.repeat(64)}`, segmentId: 'manifest', offset: 14, length: 100,
  })),
}));

const hash = `sha256:${'1'.repeat(64)}`;
const key = 'artifact-file:TRANSCRIPTS:media.json';
const text = JSON.stringify({ words: [{ text: 'Still here', start: 1, end: 2 }], transcribedRanges: [[0, 10]] });
beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); });
afterEach(() => { vi.unstubAllGlobals(); });

function fixture() {
  const storage: CoordinatorStorage = {
    publishRevision: vi.fn(async () => {}), publishNavigation: vi.fn(async () => {}),
    publishMetadata: vi.fn(async () => {}), publishJournal: vi.fn(async () => {}),
    loadProjection: vi.fn(async () => new Map()), getRevision: vi.fn(async () => null),
    getRedoChild: vi.fn(async () => null), flushViews: vi.fn(async () => {}), assertOwned: vi.fn(),
  };
  const coordinator = new ProjectTransactionCoordinator('repo', 'workspace', storage, {
    canActivate: () => true, activate: async () => {},
  });
  const artifacts = new ArtifactStore(new MemoryArtifactStorageAdapter());
  let version: string | null = null;
  const prepareSourceVersion = vi.fn(async (): Promise<string | null> => { version = hash; return version; });
  const options = { coordinator, artifacts, sourceVersion: () => version, prepareSourceVersion,
    readJournal: async () => null, applyResult: () => false };
  const setEntity = (entity: EntityDTO) => {
    const token = coordinator.begin('fixture');
    coordinator.write(token, key, entity);
    coordinator.commit(token);
  };
  return { coordinator, artifacts, options, prepareSourceVersion, setEntity,
    setVersion: (next: string | null) => { version = next; },
    host: createRepositoryDomainPublication(options) };
}

describe('durable source-bound artifact saves', () => {
  it('verifies before saving and reads the same transcript after reopening', async () => {
    const f = fixture();
    await expect(f.host.writeFile('TRANSCRIPTS', 'media.json', text)).resolves.toBe(true);
    expect(f.prepareSourceVersion).toHaveBeenCalledWith('media.json');
    const id = (f.coordinator.getEntities().get(key)!.value as { artifactId: string }).artifactId;
    expect((await f.artifacts.getArtifactManifest(id))?.sourceRefs).toEqual([hash]);
    const reopened = createRepositoryDomainPublication(f.options);
    expect(await (await reopened.readFile('TRANSCRIPTS', 'media.json'))?.text()).toBe(text);
  });

  it('fails explicitly without publishing an unreadable transcript when verification is unavailable', async () => {
    const f = fixture();
    f.prepareSourceVersion.mockResolvedValue(null);
    const put = vi.spyOn(f.artifacts, 'putArtifact');
    await expect(f.host.writeFile('TRANSCRIPTS', 'media.json', text)).rejects.toThrow('original media source is not verified');
    expect(put).not.toHaveBeenCalled();
    expect(f.coordinator.getEntities().has(key)).toBe(false);
  });

  it('does not overwrite a newer binding that arrived while source verification was pending', async () => {
    const f = fixture();
    let complete!: () => void;
    f.prepareSourceVersion.mockImplementation(() => new Promise(resolve => {
      complete = () => { f.setVersion(hash); resolve(hash); };
    }));
    const pending = f.host.writeFile('TRANSCRIPTS', 'media.json', text);
    const deleted: EntityDTO = { type: 'repository-artifact-tombstone', schemaVersion: 1, value: null, references: [], blobs: [] };
    f.setEntity(deleted);
    complete();
    expect(await pending).toBe(false);
    expect(f.coordinator.getEntities().get(key)).toEqual(deleted);
  });

  it('retains an old unbound artifact but requires an explicit verified recovery', async () => {
    const f = fixture();
    const old = await f.artifacts.putArtifact(new Blob([text], { type: 'application/json' }), { sourceRefs: [] });
    f.setEntity({ type: 'repository-artifact-file', schemaVersion: 1,
      value: { artifactId: old.manifest.artifactId }, references: [], blobs: [] });
    f.setVersion(hash);
    expect(await f.host.readFile('TRANSCRIPTS', 'media.json')).toBeNull();
    await f.host.writeFile('TRANSCRIPTS', 'media.json', text);
    expect(await (await f.host.readFile('TRANSCRIPTS', 'media.json'))?.text()).toBe(text);
    expect((await f.artifacts.getArtifactManifest(old.manifest.artifactId))?.sourceRefs).toEqual([]);
    f.setVersion(`sha256:${'2'.repeat(64)}`);
    expect(await f.host.readFile('TRANSCRIPTS', 'media.json')).toBeNull();
  });

  it('also verifies analysis saves, while unrelated documents need no media source', async () => {
    const f = fixture();
    await f.host.writeFile('ANALYSIS', 'media.json', '{}');
    expect(f.prepareSourceVersion).toHaveBeenCalledOnce();
    f.setVersion(null);
    f.prepareSourceVersion.mockClear();
    await expect(f.host.writeFile('DOCUMENTS', 'notes.json', '{}')).resolves.toBe(true);
    expect(f.prepareSourceVersion).not.toHaveBeenCalled();
  });
});
