import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMediaSourceMismatch, isRestoredMediaSourceCompatible } from '../../src/services/project/mediaSourceValidation';
import { hydrateProjectMediaRuntimeSources } from '../../src/services/project/load/loadMediaRuntimeSources';
import type { ProjectMediaFile } from '../../src/services/projectFileService';

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(), hash: vi.fn(), storedProjectHandle: vi.fn(), cacheHandle: vi.fn(),
  raw: vi.fn(), sourceRoot: vi.fn(), runtimeHandle: vi.fn(), storedHandle: vi.fn(), storeHandle: vi.fn(), url: vi.fn(),
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
vi.mock('../../src/services/projectDB', () => ({ projectDB: { getStoredHandle: mocks.storedHandle, storeHandle: mocks.storeHandle } }));
vi.mock('../../src/services/project/mediaSourceRoots', () => ({ readProjectMediaSourceFile: mocks.sourceRoot }));
vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({
  createPrimaryMediaObjectUrl: mocks.url, createRenderablePrimaryMediaObjectUrl: mocks.url,
  createMediaObjectUrl: vi.fn(), getModelSequenceFrameObjectUrlKey: vi.fn(), getGaussianSplatSequenceFrameObjectUrlKey: vi.fn(),
}));

const hash = 'a'.repeat(64);
const expected = { name: 'long.mp4', type: 'video', duration: 92.458666, fileSize: 4, fileHash: hash };
const shortFile = () => new File(['data'], 'short.mp4', { type: 'video/mp4' });
const handleFor = (file: File) => ({
  kind: 'file', name: file.name, getFile: vi.fn(async () => file), queryPermission: vi.fn(async () => 'granted'),
}) as unknown as FileSystemFileHandle;

beforeEach(() => {
  const cache = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => cache.get(key) ?? null,
    setItem: (key: string, value: string) => cache.set(key, value) });
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
  it('reuses fingerprint-validated handles when codec duration is unavailable', async () => {
    const records = new Map<string, FileSystemHandle>();
    mocks.storedHandle.mockImplementation(async (key: string) => records.get(key) ?? null);
    mocks.storeHandle.mockImplementation(async (key: string, handle: FileSystemHandle) => { records.set(key, handle); });
    mocks.metadata.mockResolvedValue({});
    const file = () => new File(['data'], 'original.mxf', { lastModified: 1234 });
    const handle = { ...handleFor(file()), isSameEntry: vi.fn(async () => true) } as FileSystemFileHandle;
    expect(await isRestoredMediaSourceCompatible(expected, file(), handle)).toBe(true);
    expect(await isRestoredMediaSourceCompatible(expected, file(), handle)).toBe(true);
    expect(mocks.hash).toHaveBeenCalledTimes(1); expect(mocks.metadata).toHaveBeenCalledTimes(1);
    await isRestoredMediaSourceCompatible({ ...expected, duration: 200 }, file(), handle);
    expect(mocks.hash).toHaveBeenCalledTimes(2); expect(mocks.metadata).toHaveBeenCalledTimes(2);
  });
  it('caches validated legacy sources only for the same physical handle and snapshot', async () => {
    const records = new Map<string, FileSystemHandle>();
    mocks.storedHandle.mockImplementation(async (key: string) => records.get(key) ?? null);
    mocks.storeHandle.mockImplementation(async (key: string, handle: FileSystemHandle) => { records.set(key, handle); });
    mocks.metadata.mockResolvedValue({ duration: 92.46 });
    const legacy = { ...expected, fileHash: undefined };
    const file = (stamp = 1234) => new File(['data'], 'original.mp4', { lastModified: stamp });
    const handle = { ...handleFor(file()), isSameEntry: vi.fn(async () => true) } as FileSystemFileHandle;
    expect(await isRestoredMediaSourceCompatible(legacy, file(), handle)).toBe(true);
    expect(await isRestoredMediaSourceCompatible(legacy, file(), handle)).toBe(true);
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
    expect(mocks.hash).not.toHaveBeenCalled();
    handle.isSameEntry = vi.fn(async () => false);
    mocks.metadata.mockResolvedValue({ duration: 2.54 });
    expect(await isRestoredMediaSourceCompatible(legacy, file(), handle)).toBe(false);
    expect(await isRestoredMediaSourceCompatible(legacy, file(2345), handle)).toBe(false);
    expect(await getMediaSourceMismatch(legacy, file(), 'relink')).toContain('expects');
    expect(mocks.metadata).toHaveBeenCalledTimes(4);
  });
  it('reopens the same validated file handle without rereading media bytes', async () => {
    const records = new Map<string, FileSystemHandle>();
    mocks.storedHandle.mockImplementation(async (key: string) => records.get(key) ?? null);
    mocks.storeHandle.mockImplementation(async (key: string, handle: FileSystemHandle) => { records.set(key, handle); });
    mocks.metadata.mockResolvedValue({ duration: 92.46 });
    const original = (stamp = 1234) => new File(['data'], 'original.mp4', { lastModified: stamp });
    const handle = { ...handleFor(original()), isSameEntry: vi.fn(async () => true) } as FileSystemFileHandle;
    expect(await isRestoredMediaSourceCompatible(expected, original(), handle)).toBe(true);
    expect(await isRestoredMediaSourceCompatible(expected, original(), handle)).toBe(true);
    expect(mocks.hash).toHaveBeenCalledTimes(1);
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
    // A changed timestamp requires fresh validation even at the same physical location.
    expect(await isRestoredMediaSourceCompatible(expected, original(2345), handle)).toBe(true);
    expect(mocks.hash).toHaveBeenCalledTimes(2);
    expect(mocks.metadata).toHaveBeenCalledTimes(2);
    // A different handle cannot borrow validation merely by matching name/size/timestamp.
    handle.isSameEntry = vi.fn(async () => false);
    mocks.hash.mockResolvedValue('b'.repeat(64));
    expect(await isRestoredMediaSourceCompatible(expected, original(), handle)).toBe(false);
    expect(mocks.hash).toHaveBeenCalledTimes(3);
  });
  it('reuses parsed duration after reload only after checking the fresh fingerprint and size', async () => {
    mocks.metadata.mockResolvedValue({ duration: 92.46 });
    const original = () => new File(['data'], 'original.mp4', { lastModified: 1234 });
    expect(await getMediaSourceMismatch(expected, original())).toBeNull();
    expect(await getMediaSourceMismatch(expected, original())).toBeNull();
    expect(mocks.hash).toHaveBeenCalledTimes(2);
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
    // The cached ACTUAL duration must still reject incompatible project metadata.
    expect(await getMediaSourceMismatch({ ...expected, duration: 200 }, original())).toContain('200.00 seconds');
    mocks.hash.mockResolvedValue('b'.repeat(64));
    expect(await getMediaSourceMismatch(expected, original())).toContain('fingerprint');
  });

  it('probes changed files and explicit relinks again', async () => {
    mocks.metadata.mockResolvedValue({ duration: 92.46 });
    const original = (lastModified: number) => new File(['data'], 'original.mp4', { lastModified });
    await getMediaSourceMismatch(expected, original(1234));
    await getMediaSourceMismatch(expected, original(2345));
    await getMediaSourceMismatch(expected, original(1234), 'relink');
    expect(mocks.metadata).toHaveBeenCalledTimes(3);
  });
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
  it('opens the saved location without hash or duration probes when automatic demand trusts it', async () => {
    const file = shortFile(); mocks.storedProjectHandle.mockResolvedValue(handleFor(file));
    const result = await hydrateProjectMediaRuntimeSources(projectMedia(), true, true);
    expect(result.representativeFile).toBe(file);
    expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it('does not search basename candidates when a saved source location is missing', async () => {
    const result = await hydrateProjectMediaRuntimeSources({ ...projectMedia(), projectPath: undefined }, true, true);
    expect(result.representativeFile).toBeUndefined(); expect(mocks.raw).not.toHaveBeenCalled();
  });
  it('remembers external source-root handles and reopens them before searching Raw paths', async () => {
    const file = shortFile(); const handle = handleFor(file);
    mocks.metadata.mockResolvedValue({ duration: expected.duration });
    mocks.sourceRoot.mockResolvedValue({ file, handle });
    expect((await hydrateProjectMediaRuntimeSources({ ...projectMedia(), sourceRootId: 'root' }, true)).representativeFile).toBe(file);
    expect(mocks.cacheHandle).toHaveBeenCalledWith('long-source', handle, true);
    mocks.storedProjectHandle.mockResolvedValue(handle); mocks.raw.mockClear(); mocks.sourceRoot.mockClear(); mocks.cacheHandle.mockClear();
    expect((await hydrateProjectMediaRuntimeSources({ ...projectMedia(), sourceRootId: 'root' }, true)).representativeFile).toBe(file);
    expect(mocks.raw).not.toHaveBeenCalled(); expect(mocks.sourceRoot).not.toHaveBeenCalled();
    expect(mocks.cacheHandle).not.toHaveBeenCalled();
  });

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
