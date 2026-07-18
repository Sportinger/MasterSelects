import { describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../../stores/mediaStore';
import { commitCaptureRecording, type CaptureCommitOptions } from '../recording/commitRecording';
import {
  readCaptureRecoveryEntries,
  upsertCaptureRecoveryEntry,
  type CaptureRecoveryBlobStore,
  type CaptureRecoveryChunkInput,
  type CaptureRecoveryChunkRef,
} from '../recording/recoveryPersistence';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class MemoryBlobStore implements CaptureRecoveryBlobStore {
  readonly blobs = new Map([['artifact-0', new Blob(['video'], { type: 'video/webm' })]]);
  async putChunk(_input: CaptureRecoveryChunkInput): Promise<CaptureRecoveryChunkRef> { throw new Error('not used'); }
  async getChunk(ref: CaptureRecoveryChunkRef): Promise<Blob | null> { return this.blobs.get(ref.artifactId) ?? null; }
  async deleteRef(artifactId: string): Promise<void> { this.blobs.delete(artifactId); }
}

function seed(storage: MemoryStorage, sessionId: string, committedMediaFileId?: string): void {
  upsertCaptureRecoveryEntry(storage, {
    sessionId,
    status: committedMediaFileId ? 'committed' : 'stopped',
    tier: 'media-recorder',
    startedAt: new Date(2026, 6, 12, 14, 32, 5).getTime(),
    mimeType: 'video/webm',
    durationSeconds: 4,
    bytes: 5,
    chunks: [{
      artifactId: 'artifact-0', chunkIndex: 0, mimeType: 'video/webm', bytes: 5, startedAt: 1000, timeStart: 0, duration: 4,
    }],
    committedMediaFileId,
  });
}

function result(sessionId: string) {
  return { sessionId, mimeType: 'video/webm', durationSeconds: 4, bytes: 5, artifactIds: ['artifact-0'] };
}

describe('commitCaptureRecording', () => {
  it('reuses the Recordings folder and patches invalid probed duration', async () => {
    const storage = new MemoryStorage();
    const folders: Array<{ id: string; name: string; parentId: string | null }> = [];
    const media = new Map<string, MediaFile>();
    const createFolder = vi.fn((name: string, parentId?: string | null) => {
      const folder = { id: 'recordings', name, parentId: parentId ?? null };
      folders.push(folder);
      return folder;
    });
    const patchMediaDuration = vi.fn((id: string, duration: number) => {
      media.set(id, { ...media.get(id)!, duration });
    });
    const importFile = vi.fn(async (
      file: File,
      parentId?: string | null,
      _options?: { forceCopyToProject?: boolean; projectFileName?: string },
    ) => {
      const imported = {
        id: `media-${media.size + 1}`, name: file.name, type: 'video' as const, parentId: parentId ?? null,
        createdAt: 1, file, url: 'blob:recording', duration: Infinity,
      };
      media.set(imported.id, imported);
      return imported;
    });
    const base: CaptureCommitOptions = {
      recoveryStorage: storage,
      blobStore: new MemoryBlobStore(),
      isProjectOpen: () => true,
      listFolders: () => folders,
      createFolder,
      importFile,
      getMediaFileById: id => media.get(id),
      patchMediaDuration,
    };

    seed(storage, 'session-a');
    await commitCaptureRecording(result('session-a'), base);
    seed(storage, 'session-b');
    await commitCaptureRecording(result('session-b'), { ...base, blobStore: new MemoryBlobStore() });

    expect(createFolder).toHaveBeenCalledOnce();
    expect(importFile).toHaveBeenCalledTimes(2);
    expect(importFile.mock.calls[0]?.[1]).toBe('recordings');
    expect(importFile.mock.calls[0]?.[2]).toMatchObject({ forceCopyToProject: true });
    expect(patchMediaDuration).toHaveBeenCalledWith('media-1', 4);
    expect(media.get('media-1')?.duration).toBe(4);
  });

  it('does not import again when a reloaded ledger already records the committed media id', async () => {
    const storage = new MemoryStorage();
    const imported = {
      id: 'media-existing', name: 'Screen Recording.webm', type: 'video' as const, parentId: 'recordings',
      createdAt: 1, file: new File(['video'], 'Screen Recording.webm'), url: 'blob:existing', duration: 4,
    };
    seed(storage, 'session-reloaded', imported.id);
    const importFile = vi.fn();

    const committed = await commitCaptureRecording(result('session-reloaded'), {
      recoveryStorage: storage,
      blobStore: new MemoryBlobStore(),
      isProjectOpen: () => true,
      getMediaFileById: id => id === imported.id ? imported : undefined,
      importFile,
    });

    expect(committed.mediaFileId).toBe(imported.id);
    expect(committed.alreadyCommitted).toBe(true);
    expect(importFile).not.toHaveBeenCalled();
  });

  it('makes timeline placement one undo step while keeping the imported media', async () => {
    const storage = new MemoryStorage();
    seed(storage, 'session-placement');
    const mediaIds = new Set<string>();
    const clipIds = new Set<string>();
    const snapshots: Array<{ mediaIds: Set<string>; clipIds: Set<string> }> = [];
    const imported: MediaFile = {
      id: 'media-1', name: 'Screen Recording.webm', type: 'video', parentId: 'recordings', createdAt: 1,
      file: new File(['video'], 'Screen Recording.webm'), url: 'blob:recording', duration: 4,
    };

    await commitCaptureRecording(result('session-placement'), {
      recoveryStorage: storage,
      blobStore: new MemoryBlobStore(),
      isProjectOpen: () => true,
      listFolders: () => [{ id: 'recordings', name: 'Recordings', parentId: null }],
      importFile: async () => { mediaIds.add(imported.id); return imported; },
      getMediaFileById: id => id === imported.id ? imported : undefined,
      placeOnTimeline: true,
      captureHistorySnapshot: () => snapshots.push({ mediaIds: new Set(mediaIds), clipIds: new Set(clipIds) }),
      placeMediaOnTimeline: async () => { clipIds.add('clip-1'); return { success: true, createdClipId: 'clip-1' }; },
    });

    const undoState = snapshots[0]!;
    expect(snapshots).toHaveLength(2);
    expect(undoState.clipIds).not.toContain('clip-1');
    expect(undoState.mediaIds).toContain('media-1');
    expect(readCaptureRecoveryEntries(storage)).toEqual([]);
  });
});
