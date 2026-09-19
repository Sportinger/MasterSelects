import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { encodeProjectTerrain } from '../../src/services/project/core/packageTerrainGeometry';
import { ArtifactStore, blobToArrayBuffer, ProjectPackageArtifactStorageAdapter } from '../../src/artifacts';
import type { ProjectFile } from '../../src/services/project/types';
import {
  decodeProjectPackage,
  getFsaProjectFolderPath,
  getProjectMediaFolderName,
  getProjectPackageFileName,
  ProjectPackageSession,
  registerFsaProjectPackageSession,
} from '../../src/services/project/core/projectPackage';
import { writeFsaProjectPackage } from '../../src/services/project/core/projectCorePersistence';

function createProject(name = 'Package Test'): ProjectFile {
  return {
    version: 1,
    name,
    createdAt: '2026-08-18T10:00:00.000Z',
    updatedAt: '2026-08-18T10:05:00.000Z',
    settings: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      sampleRate: 48000,
    },
    media: [],
    compositions: [],
    folders: [],
    activeCompositionId: null,
    openCompositionIds: [],
    expandedFolderIds: [],
  };
}

describe('.msproj project package', () => {
  it('stages sequential decoder artifacts and flushes the group once after processing', async () => {
    const session = ProjectPackageSession.create(createProject());
    const persist = vi.fn(async () => true); session.setPersistCallback(persist);
    await session.batchWrites(async () => {
      for (let i = 0; i < 20; i++) await session.writeEntry('CACHE_ARTIFACTS', `pcm-${i}`, `${i}`);
      await session.batchWrites(async () => {
        await session.writeEntry('ANALYSIS', 'waveform', 'ready');
      });
      expect(persist).not.toHaveBeenCalled();
      expect(session.isBatchingWrites).toBe(true);
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(session.isBatchingWrites).toBe(false);
  });
  it('keeps failed grouped writes retryable and releases waiting saves', async () => {
    const session = ProjectPackageSession.create(createProject());
    const persist = vi.fn(async () => false); session.setPersistCallback(persist);
    await expect(session.batchWrites(async () => {
      await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'samples');
    })).rejects.toThrow('artifact batch');
    await session.waitForWriteBatch();
    expect(session.isBatchingWrites).toBe(false);
    persist.mockResolvedValue(true);
    expect(await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'samples')).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it.each([new Error('Artifact processing failed'), undefined])('preserves a work rejection when the staged artifacts persist (%s)', async (workError) => {
    const session = ProjectPackageSession.create(createProject());
    const persist = vi.fn(async () => true);
    session.setPersistCallback(persist);
    await expect(session.batchWrites(async () => {
      await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'samples');
      throw workError;
    })).rejects.toBe(workError);
    expect(persist).toHaveBeenCalledOnce();
    expect(session.isBatchingWrites).toBe(false);
    await session.waitForWriteBatch();
  });

  it.each(['false', 'throw'] as const)('retains both work and persistence failures when saving fails via %s', async (failureMode) => {
    const session = ProjectPackageSession.create(createProject());
    const workError = new Error('Could not decode artifact');
    const persistError = new Error('Storage unavailable');
    const persist = vi.fn(async () => {
      if (failureMode === 'throw') throw persistError;
      return false;
    });
    session.setPersistCallback(persist);
    const result = session.batchWrites(async () => {
      await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'samples');
      throw workError;
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({ errors: [
      workError,
      failureMode === 'throw' ? persistError : expect.objectContaining({ message: 'Could not persist project artifact batch' }),
    ] });
    expect(session.isBatchingWrites).toBe(false);
    await session.waitForWriteBatch();
    persist.mockResolvedValue(true);
    expect(await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'samples')).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('releases the batch before its save callback waits for it and awaits the final save', async () => {
    const session = ProjectPackageSession.create(createProject());
    let startPersist!: () => void;
    const persistStarted = new Promise<void>(resolve => { startPersist = resolve; });
    let finishPersist!: (saved: boolean) => void;
    const persisted = new Promise<boolean>(resolve => { finishPersist = resolve; });
    session.setPersistCallback(async () => {
      await session.waitForWriteBatch();
      startPersist();
      return persisted;
    });
    let completed = false;
    const batch = session.batchWrites(async () => {
      await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'samples');
      return 'artifact result';
    }).then(value => { completed = true; return value; });
    const waitingSave = session.waitForWriteBatch();
    await persistStarted;
    await waitingSave;
    expect(session.isBatchingWrites).toBe(false);
    expect(completed).toBe(false);
    finishPersist(true);
    await expect(batch).resolves.toBe('artifact result');
  });

  it('stores mesh payloads once and reuses compressed geometry after a reload', async () => {
    const project = createProject();
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2],
      origin: [0, 0, 0], axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, 1], size: [1, 1] };
    project.compositions = [{ clips: [{ planarTracks: [{ terrain: {
      denseMesh: mesh, footsteps: [{ placement: { x: 1 }, mesh }],
    } }] }] }] as unknown as ProjectFile['compositions'];
    const initial = await encodeProjectTerrain(project);
    expect(initial.entries).toHaveLength(1);
    const session = ProjectPackageSession.create(project);
    const chunks: Uint8Array[] = [];
    await session.streamEncode(project, async chunk => { chunks.push(chunk.slice()); });
    const encoded = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { encoded.set(chunk, offset); offset += chunk.length; }
    const raw = unzipSync(encoded);
    expect(strFromU8(raw['project.json'])).not.toContain('"positions"');
    const restored = await decodeProjectPackage(encoded);
    expect(restored.projectData).toEqual(project);
    const terrain = restored.projectData.compositions[0].clips[0].planarTracks![0].terrain!;
    expect(terrain.denseMesh).toBe(terrain.footsteps![0].mesh);
    terrain.footsteps![0].placement.x = 2;
    const next = await encodeProjectTerrain(restored.projectData);
    expect(next.entries[0][0]).toBe(initial.entries[0][0]);
    expect([...next.entries[0][1]]).toEqual([...initial.entries[0][1]]);
    const repeat = await encodeProjectTerrain(restored.projectData);
    expect(repeat.entries[0][1]).toBe(next.entries[0][1]);
  });

  it('round-trips project data and durable sidecars through a ZIP container', async () => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    await session.writeEntry('TRANSCRIPTS', 'media-1.json', JSON.stringify({ words: [{ text: 'Hallo' }] }));
    await session.writeEntry('ANALYSIS', 'media-1.json', JSON.stringify({ analyses: { full: { frames: [] } } }));

    const archive = await decodeProjectPackage(await session.encode(project));

    expect(archive.projectData).toEqual(project);
    expect(archive.manifest).toMatchObject({
      format: 'masterselects-project',
      formatVersion: 1,
      projectName: 'Package Test',
      mediaFolderName: 'Package Test Media',
      contentMode: 'linked-media',
    });
    expect(new TextDecoder().decode(archive.entries.get('Transcripts/media-1.json')))
      .toContain('Hallo');
    expect(archive.manifest.excludes).toContain('undo-snapshots');
    expect(archive.manifest.excludes).toContain('raw-media');
  });

  it('uses a named media folder and hidden cache paths for new package projects', () => {
    const handle = {} as FileSystemDirectoryHandle;
    registerFsaProjectPackageSession(handle, ProjectPackageSession.create(createProject('Mein Film')));

    expect(getFsaProjectFolderPath(handle, 'RAW')).toBe('Mein Film Media');
    expect(getFsaProjectFolderPath(handle, 'RAW_BAKED_AUDIO')).toBe('Mein Film Media/Baked Audio');
    expect(getFsaProjectFolderPath(handle, 'DOWNLOADS')).toBe('Mein Film Media/Downloads');
    expect(getFsaProjectFolderPath(handle, 'CACHE_THUMBNAILS')).toBe('Mein Film Media/.masterselects-cache/thumbnails');
  });

  it('keeps legacy physical folders after non-destructive migration', () => {
    const handle = {} as FileSystemDirectoryHandle;
    const session = ProjectPackageSession.create(createProject('Legacy'));
    session.setMediaFolderName('Raw');
    registerFsaProjectPackageSession(handle, session);

    expect(getFsaProjectFolderPath(handle, 'RAW')).toBe('Raw');
    expect(getFsaProjectFolderPath(handle, 'ANALYSIS')).toBe('Analysis');
    expect(getFsaProjectFolderPath(handle, 'CACHE')).toBe('Cache');
  });

  it('persists package-entry changes through the configured project save queue', async () => {
    const session = ProjectPackageSession.create(createProject());
    const persist = vi.fn(async () => true);
    session.setPersistCallback(persist);

    await expect(session.writeEntry('AI_CHAT', 'history.json', '{}')).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not rewrite the whole project for identical sidecar content', async () => {
    const session = ProjectPackageSession.create(createProject());
    const persist = vi.fn(async () => true);
    session.setPersistCallback(persist);
    await session.writeEntry('AI_CHAT', 'history.json', '{}');
    await session.writeEntry('AI_CHAT', 'history.json', '{}');
    await session.writeEntries([{ folder: 'AI_CHAT', fileName: 'history.json', content: '{}' }]);
    expect(persist).toHaveBeenCalledTimes(1);
    await session.writeEntry('AI_CHAT', 'history.json', '[]');
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('retries unchanged sidecar content after its previous write failed', async () => {
    const session = ProjectPackageSession.create(createProject());
    const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    session.setPersistCallback(persist);
    expect(await session.writeEntry('AI_CHAT', 'history.json', '{}')).toBe(false);
    expect(await session.writeEntry('AI_CHAT', 'history.json', '{}')).toBe(true);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('keeps durable binary analysis artifacts inside the package', async () => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    const store = new ArtifactStore(new ProjectPackageArtifactStorageAdapter(session));
    const stored = await store.putArtifact(new Blob(['analysis payload'], { type: 'application/json' }), {
      sourceRefs: ['media-1'],
    });

    const archive = await decodeProjectPackage(await session.encode(project));
    const reopenedSession = ProjectPackageSession.fromArchive(archive, 'Package Test.msproj');
    const reopenedStore = new ArtifactStore(new ProjectPackageArtifactStorageAdapter(reopenedSession));
    const reopened = await reopenedStore.getArtifact(stored.manifest.artifactId);

    expect(new TextDecoder().decode(await blobToArrayBuffer(reopened!.blob))).toBe('analysis payload');
    expect([...archive.entries.keys()].some((path) => path.startsWith('Cache/artifacts/sha256/'))).toBe(true);
  });

  it('sanitizes the package and media companion names consistently', () => {
    expect(getProjectPackageFileName('Cut: 01?')).toBe('Cut- 01-.msproj');
    expect(getProjectMediaFolderName('Cut: 01?')).toBe('Cut- 01- Media');
  });

  it('writes a complete package buffer without copying it on the main thread', async () => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    const packageBuffer = new ArrayBuffer(16);
    vi.spyOn(session, 'streamEncode').mockImplementation(async (_projectData, writeChunk) => {
      await writeChunk(new Uint8Array(packageBuffer));
    });
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const handle = {
      getFileHandle: vi.fn(async () => ({
        createWritable: vi.fn(async () => ({ write, close })),
      })),
    } as unknown as FileSystemDirectoryHandle;

    await writeFsaProjectPackage(handle, session, project);

    expect(write).toHaveBeenCalledWith(packageBuffer);
    expect(close).toHaveBeenCalledOnce();
  });

  it('copies only the visible bytes when a package uses a partial buffer view', async () => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    const packageBuffer = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    vi.spyOn(session, 'streamEncode').mockImplementation(async (_projectData, writeChunk) => {
      await writeChunk(packageBuffer.subarray(2, 5));
    });
    const write = vi.fn(async () => undefined);
    const handle = {
      getFileHandle: vi.fn(async () => ({
        createWritable: vi.fn(async () => ({ write, close: vi.fn(async () => undefined) })),
      })),
    } as unknown as FileSystemDirectoryHandle;

    await writeFsaProjectPackage(handle, session, project);

    const writtenBuffer = write.mock.calls[0]?.[0] as ArrayBuffer;
    expect([...new Uint8Array(writtenBuffer)]).toEqual([2, 3, 4]);
  });

  it('streams a valid package archive in bounded output chunks', async () => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    await session.writeEntry('TRANSCRIPTS', 'media-1.json', JSON.stringify({ text: 'streamed' }));
    const chunks: Uint8Array[] = [];

    await session.streamEncode(project, async (chunk) => {
      chunks.push(new Uint8Array(chunk));
    });

    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const packageBytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      packageBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const archive = await decodeProjectPackage(packageBytes);
    expect(archive.projectData).toEqual(project);
    expect(new TextDecoder().decode(archive.entries.get('Transcripts/media-1.json'))).toContain('streamed');
  });
});


describe('package writable acquisition recovery', () => {
  it.each(['handle', 'writable'])('reacquires a stale %s before streaming a valid archive', async (stage) => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    let committed: Uint8Array | null = null;
    const chunks: Uint8Array[] = [];
    const writable = {
      write: vi.fn(async (buffer: ArrayBuffer) => { chunks.push(new Uint8Array(buffer).slice()); }),
      close: vi.fn(async () => {
        committed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) { committed.set(chunk, offset); offset += chunk.length; }
      }),
      abort: vi.fn(),
    };
    let attempts = 0;
    const stale = new DOMException('Cached file state changed', 'InvalidStateError');
    const getFileHandle = vi.fn(async () => {
      attempts++;
      if (attempts === 1 && stage === 'handle') throw stale;
      const currentAttempt = attempts;
      return { createWritable: async () => {
        if (currentAttempt === 1) throw stale;
        return writable;
      } };
    });
    await writeFsaProjectPackage({ getFileHandle } as unknown as FileSystemDirectoryHandle, session, project);
    expect(getFileHandle).toHaveBeenCalledTimes(2);
    expect(writable.close).toHaveBeenCalledOnce();
    expect(writable.abort).not.toHaveBeenCalled();
    expect((await decodeProjectPackage(committed!)).projectData).toEqual(project);
  });

  it.each([
    ['InvalidStateError', 'Cached file state changed', 3],
    ['AbortError', 'Failed to create swap file.', 3],
    ['NotAllowedError', 'Permission denied', 1],
    ['QuotaExceededError', 'Disk is full', 1],
  ])('bounds acquisition failure %s and does not start encoding', async (name, message, attempts) => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    const encode = vi.spyOn(session, 'streamEncode');
    const error = new DOMException(message as string, name as string);
    const getFileHandle = vi.fn(async () => ({ createWritable: async () => { throw error; } }));
    await expect(writeFsaProjectPackage({ getFileHandle } as unknown as FileSystemDirectoryHandle, session, project)).rejects.toBe(error);
    expect(getFileHandle).toHaveBeenCalledTimes(attempts as number);
    expect(encode).not.toHaveBeenCalled();
  });

  it('aborts a failed write and does not retry or commit partially written bytes', async () => {
    const project = createProject();
    const session = ProjectPackageSession.create(project);
    const original = await session.encode(project);
    let stored = original;
    const error = new DOMException('Cached file state changed while writing', 'InvalidStateError');
    const writable = {
      write: vi.fn(async () => { throw error; }),
      close: vi.fn(async () => { stored = new Uint8Array(); }),
      abort: vi.fn(async () => undefined),
    };
    const getFileHandle = vi.fn(async () => ({ createWritable: async () => writable }));
    await expect(writeFsaProjectPackage({ getFileHandle } as unknown as FileSystemDirectoryHandle, session, project)).rejects.toBe(error);
    expect(writable.abort).toHaveBeenCalledOnce();
    expect(writable.close).not.toHaveBeenCalled();
    expect(getFileHandle).toHaveBeenCalledTimes(1);
    expect(stored).toBe(original);
  });
});
