import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMediaSourceMismatch, isRestoredMediaSourceCompatible } from '../../src/services/project/mediaSourceValidation';
import { hydrateProjectMediaRuntimeSources } from '../../src/services/project/load/loadMediaRuntimeSources';
import type { ProjectMediaFile } from '../../src/services/projectFileService';

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(), hash: vi.fn(), storedProjectHandle: vi.fn(), cacheHandle: vi.fn(),
  raw: vi.fn(), sourceRoot: vi.fn(), runtimeHandle: vi.fn(), storedHandle: vi.fn(), url: vi.fn(),
}));
vi.mock('../../src/stores/mediaStore/helpers/mediaInfoHelpers', () => ({ getMediaInfo: mocks.metadata }));
vi.mock('../../src/stores/mediaStore/helpers/fileHashHelpers', () => ({ calculateFileHash: mocks.hash }));
vi.mock('../../src/services/project/mediaSourceResolver', () => ({
  getStoredProjectFileHandle: mocks.storedProjectHandle,
  cacheProjectFileHandle: mocks.cacheHandle,
  getProjectRawPathCandidates: () => ['Raw/short.mp4', 'Raw/long.mp4'],
}));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: { isProjectOpen: () => true, getFileFromRaw: mocks.raw },
}));
vi.mock('../../src/services/fileSystemService', () => ({
  fileSystemService: { getFileHandle: mocks.runtimeHandle, storeFileHandle: vi.fn() },
}));
vi.mock('../../src/services/projectDB', () => ({ projectDB: { getStoredHandle: mocks.storedHandle } }));
vi.mock('../../src/services/project/mediaSourceRoots', () => ({ readProjectMediaSourceFile: mocks.sourceRoot }));
vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({
  createPrimaryMediaObjectUrl: mocks.url,
  createMediaObjectUrl: vi.fn(), getModelSequenceFrameObjectUrlKey: vi.fn(), getGaussianSplatSequenceFrameObjectUrlKey: vi.fn(),
}));

const hash = 'a'.repeat(64);
const expected = { name: 'long.mp4', type: 'video', duration: 92.458666, fileSize: 4, fileHash: hash };
const shortFile = () => new File(['data'], 'short.mp4', { type: 'video/mp4' });
const handleFor = (file: File) => ({
  kind: 'file', name: file.name, getFile: vi.fn(async () => file), queryPermission: vi.fn(async () => 'granted'),
}) as unknown as FileSystemFileHandle;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.hash.mockResolvedValue(hash);
  mocks.metadata.mockResolvedValue({ duration: 2.538666 });
  mocks.storedProjectHandle.mockResolvedValue(null);
  mocks.raw.mockResolvedValue(null);
  mocks.sourceRoot.mockResolvedValue(null);
  mocks.storedHandle.mockResolvedValue(null);
  mocks.url.mockReturnValue('blob:verified');
});

describe('project media source validation', () => {
  it('rejects the wrong duration even when the saved size and hash already match the wrong file', async () => {
    const mismatch = await getMediaSourceMismatch(expected, shortFile());
    expect(mismatch).toContain('92.46 seconds');
    expect(mismatch).toContain('2.54 seconds');
  });

  it('rejects a same-size source with a different fingerprint during automatic restore', async () => {
    mocks.hash.mockResolvedValue('b'.repeat(64));
    expect(await getMediaSourceMismatch(expected, shortFile())).toContain('fingerprint');
  });

  it('rejects size mismatches before expensive metadata work', async () => {
    expect(await getMediaSourceMismatch({ ...expected, fileSize: 100 }, shortFile())).toContain('file size');
    expect(mocks.metadata).not.toHaveBeenCalled();
  });

  it('accepts renamed originals and small differences between metadata reader versions', async () => {
    mocks.metadata.mockResolvedValue({ duration: 92.4 });
    expect(await getMediaSourceMismatch(expected, shortFile())).toBeNull();
  });

  it('can validate an older project without a stored fingerprint or size', async () => {
    mocks.metadata.mockResolvedValue({ duration: 92.46 });
    expect(await getMediaSourceMismatch({ name: 'old.mov', type: 'video', duration: 92.46 }, shortFile())).toBeNull();
  });

  it('allows explicit relinking to repair a corrupted hash only when duration is compatible', async () => {
    mocks.hash.mockResolvedValue('b'.repeat(64));
    mocks.metadata.mockResolvedValue({ duration: 92.46 });
    expect(await getMediaSourceMismatch({ ...expected, fileSize: 100 }, shortFile(), 'relink')).toBeNull();
    mocks.metadata.mockResolvedValue({ duration: 2.54 });
    expect(await getMediaSourceMismatch(expected, shortFile(), 'relink')).toContain('expects 92.46');
  });

  it('does not accept an unreadable duration without a matching identity', async () => {
    mocks.hash.mockResolvedValue('');
    mocks.metadata.mockResolvedValue({});
    expect(await getMediaSourceMismatch(expected, shortFile(), 'relink')).toContain('Could not verify');
  });

  it('keeps exact-fingerprint sources usable when this browser cannot read their codec metadata', async () => {
    mocks.metadata.mockResolvedValue({});
    expect(await getMediaSourceMismatch(expected, shortFile())).toBeNull();
  });

  it('leaves unreadable candidates offline and never changes saved metadata', async () => {
    mocks.hash.mockRejectedValue(new Error('permission lost'));
    const saved = { ...expected };
    expect(await isRestoredMediaSourceCompatible(saved, shortFile())).toBe(false);
    expect(saved).toEqual(expected);
  });
});

describe('project load candidate validation', () => {
  const projectMedia = () => ({ ...expected, id: 'long-source', sourcePath: 'short.mp4', projectPath: 'Raw/short.mp4' }) as ProjectMediaFile;

  it('does not attach or promote a mismatched remembered project handle', async () => {
    mocks.storedProjectHandle.mockResolvedValue(handleFor(shortFile()));
    const result = await hydrateProjectMediaRuntimeSources(projectMedia(), true);
    expect(result.representativeFile).toBeUndefined();
    expect(result.representativeUrl).toBe('');
    expect(result.hasFileHandle).toBe(false);
    expect(mocks.url).not.toHaveBeenCalled();
    expect(mocks.cacheHandle).not.toHaveBeenCalled();
  });

  it('continues searching after a stale handle/path and accepts a verified original', async () => {
    const correct = new File(['data'], 'long.mp4', { type: 'video/mp4' });
    mocks.metadata.mockImplementation(async (file: File) => ({ duration: file === correct ? 92.46 : 2.54 }));
    mocks.storedProjectHandle.mockResolvedValue(handleFor(shortFile()));
    mocks.raw.mockImplementation(async (path: string) => {
      const file = path === 'Raw/long.mp4' ? correct : shortFile();
      return { file, handle: handleFor(file) };
    });
    const result = await hydrateProjectMediaRuntimeSources(projectMedia(), true);
    expect(result.representativeFile).toBe(correct);
    expect(result.representativeProjectPath).toBe('Raw/long.mp4');
    expect(mocks.url).toHaveBeenCalledTimes(1);
    expect(mocks.cacheHandle).toHaveBeenCalledTimes(1);
  });

  it('does not bypass validation via external source roots or primary cached handles', async () => {
    const file = shortFile();
    mocks.sourceRoot.mockResolvedValue({ file, handle: handleFor(file) });
    mocks.runtimeHandle.mockReturnValue(handleFor(file));
    const result = await hydrateProjectMediaRuntimeSources({ ...projectMedia(), sourceRootId: 'root' }, true);
    expect(result.representativeFile).toBeUndefined();
    expect(result.hasFileHandle).toBe(false);
    expect(mocks.url).not.toHaveBeenCalled();
  });
});
