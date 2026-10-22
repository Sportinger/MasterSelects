import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  session: null as null | { descriptor: { repositoryId: string } },
  writable: true,
  projectPaused: false,
  writeListeners: new Set<() => void>(),
  pauseListeners: new Set<() => void>(),
}));

vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => env.session,
}));
vi.mock('../../src/services/project/repository/transaction/editorWriteAvailability', () => ({
  isEditorRepositoryWritable: () => env.writable,
  subscribeEditorWriteAvailability: (listener: () => void) => {
    env.writeListeners.add(listener);
    return () => env.writeListeners.delete(listener);
  },
}));
vi.mock('../../src/services/project/folderAccess/folderAccessPause', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/project/folderAccess/folderAccessPause')>(),
  getFolderAccessPause: () => ({ paused: env.projectPaused, project: env.projectPaused, mediaIds: [], phase: 'idle', failure: null }),
  subscribeFolderAccessPause: (listener: () => void) => {
    env.pauseListeners.add(listener);
    return () => env.pauseListeners.delete(listener);
  },
}));

import {
  currentPyramidStorageMode,
  flushDeferredPyramids,
  getDeferredPyramidCount,
  isTransientArtifactStorageError,
  onDeferredPyramidPersisted,
  rememberDeferredPyramid,
  resetDeferredPyramidsForTest,
  setDeferredPyramidPersister,
} from '../../src/services/audio/waveformPyramid/deferredPyramidPersistence';
import { READ_ONLY_PROJECT_MESSAGE } from '../../src/services/editRejection';
import { replaceSourceWaveformPyramidRef } from '../../src/stores/timeline/clip/deferredPyramidRefPatch';
import type { TimelineClip } from '../../src/types/timeline';
import type { WaveformPyramidStoreRequest } from '../../src/services/audio/WaveformPyramidGenerator';

function repositoryError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'RepositoryError', code });
}

const request = { mediaFileId: 'media-1', sourceFingerprint: 'sha256:abc' } as WaveformPyramidStoreRequest;

describe('deferred waveform pyramid persistence', () => {
  beforeEach(() => {
    env.session = { descriptor: { repositoryId: 'repo-1' } };
    env.writable = true;
    env.projectPaused = false;
  });
  afterEach(() => {
    resetDeferredPyramidsForTest();
    env.writeListeners.clear();
    env.pauseListeners.clear();
  });

  it('keeps pyramids in memory in a read-only tab and while project folder access is paused', () => {
    expect(currentPyramidStorageMode()).toBe('persist');
    env.writable = false;
    expect(currentPyramidStorageMode()).toBe('memory');
    env.writable = true;
    env.projectPaused = true;
    expect(currentPyramidStorageMode()).toBe('memory');
    env.session = null;
    expect(currentPyramidStorageMode()).toBe('persist');
  });

  it('classifies read-only and paused-access storage failures as transient, wrapped or not', () => {
    const readOnly = repositoryError('ownership', READ_ONLY_PROJECT_MESSAGE);
    expect(isTransientArtifactStorageError(readOnly)).toBe(true);
    expect(isTransientArtifactStorageError(new Error('Waveform pyramid generation failed', { cause: readOnly }))).toBe(true);
    expect(isTransientArtifactStorageError(repositoryError('access', 'The request is not allowed by the user agent'))).toBe(true);
    expect(isTransientArtifactStorageError(new DOMException('denied', 'NotAllowedError'))).toBe(true);
    expect(isTransientArtifactStorageError(new Error('quota exceeded'))).toBe(false);
  });

  it('saves memory pyramids after takeover and moves clip refs to the saved artifact', async () => {
    env.writable = false;
    const persist = vi.fn(async () => 'saved-ref');
    const moved = vi.fn();
    setDeferredPyramidPersister(persist);
    onDeferredPyramidPersisted(moved);
    rememberDeferredPyramid({ memoryRef: 'memory-ref', request });
    expect(env.writeListeners.size).toBe(1);

    env.writeListeners.forEach(listener => listener());
    expect(persist).not.toHaveBeenCalled();

    env.writable = true;
    env.writeListeners.forEach(listener => listener());
    await vi.waitFor(() => expect(moved).toHaveBeenCalledWith('memory-ref', 'saved-ref'));
    expect(persist).toHaveBeenCalledWith(request);
    expect(getDeferredPyramidCount()).toBe(0);
    expect(env.writeListeners.size).toBe(0);
  });

  it('retries after folder access resumes when the first save is still refused', async () => {
    const persist = vi.fn()
      .mockRejectedValueOnce(repositoryError('access', 'NotAllowedError'))
      .mockResolvedValueOnce('saved-ref');
    setDeferredPyramidPersister(persist);
    rememberDeferredPyramid({ memoryRef: 'memory-ref', request });
    await expect(flushDeferredPyramids()).resolves.toBe(0);
    expect(getDeferredPyramidCount()).toBe(1);

    env.pauseListeners.forEach(listener => listener());
    await vi.waitFor(() => expect(getDeferredPyramidCount()).toBe(0));
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('never saves a pyramid into another project', async () => {
    const persist = vi.fn(async () => 'saved-ref');
    setDeferredPyramidPersister(persist);
    rememberDeferredPyramid({ memoryRef: 'memory-ref', request });
    env.session = { descriptor: { repositoryId: 'repo-2' } };
    await expect(flushDeferredPyramids()).resolves.toBe(0);
    expect(persist).not.toHaveBeenCalled();
    expect(getDeferredPyramidCount()).toBe(0);
  });

  it('rewrites only clips that reference the memory pyramid', () => {
    const clips = [
      { id: 'a', audioState: { sourceAnalysisRefs: { waveformPyramidId: 'memory-ref', loudnessEnvelopeId: 'l' } } },
      { id: 'b', audioState: { sourceAnalysisRefs: { waveformPyramidId: 'other' } } },
    ] as unknown as TimelineClip[];
    const next = replaceSourceWaveformPyramidRef(clips, 'memory-ref', 'saved-ref');
    expect(next[0].audioState?.sourceAnalysisRefs).toEqual({ waveformPyramidId: 'saved-ref', loudnessEnvelopeId: 'l' });
    expect(next[1]).toBe(clips[1]);
    expect(replaceSourceWaveformPyramidRef(clips, 'missing', 'saved-ref')).toBe(clips);
  });
});
