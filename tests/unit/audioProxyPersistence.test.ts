import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  getSession: vi.fn(),
  isProjectOpen: vi.fn(),
  hasProxyAudio: vi.fn(),
  saveProxyAudio: vi.fn(),
}));
vi.mock('../../src/engine/audio/AudioFileEncoder', () => ({
  encodeAudioBufferToWavBlob: () => new Blob(['wav'], { type: 'audio/wav' }),
}));
vi.mock('../../src/services/audio/AudioDecodeService', () => ({
  AudioDecodeServiceError: class AudioDecodeServiceError extends Error {},
  getSharedAudioDecodeService: () => ({ decodeAudioBuffer: mocks.decode }),
}));
vi.mock('../../src/engine/audio/exportPipeline/MediaAudioRangeReader', () => ({
  MediaAudioRangeReader: class MediaAudioRangeReader {},
}));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: mocks.isProjectOpen,
    hasProxyAudio: mocks.hasProxyAudio,
    saveProxyAudio: mocks.saveProxyAudio,
  },
}));
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: { getProjectPackageSession: mocks.getSession },
}));

import {
  ensureAudioProxyForMediaFile,
  type AudioProxyGenerationUpdate,
} from '../../src/services/audio/AudioProxyService';
import { ProjectPackageSession } from '../../src/services/project/core/projectPackage';
import type { MediaFile } from '../../src/stores/mediaStore/types';

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

function createSession() {
  return ProjectPackageSession.create({
    version: 1, name: 'Audio proxy save', createdAt: '', updatedAt: '',
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
    media: [], compositions: [], folders: [], activeCompositionId: null,
    openCompositionIds: [], expandedFolderIds: [],
  });
}

it.each(['success', 'false', 'rejection'] as const)('reports its own batch completion %s before declaring an audio proxy ready', async (outcome) => {
  const session = createSession();
  mocks.getSession.mockReturnValue(session);
  mocks.isProjectOpen.mockReturnValue(true);
  mocks.hasProxyAudio.mockResolvedValue(false);
  mocks.decode.mockImplementation(async () => {
    // Decoding stages PCM artifacts in the package; the WAV itself is a sidecar.
    await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'decoded samples');
    return { duration: 1 } as AudioBuffer;
  });
  mocks.saveProxyAudio.mockResolvedValue(true);
  let startPersist!: () => void;
  const persistStarted = new Promise<void>(resolve => { startPersist = resolve; });
  let finishPersist!: (saved: boolean) => void;
  let rejectPersist!: (reason: unknown) => void;
  const persisted = new Promise<boolean>((resolve, reject) => { finishPersist = resolve; rejectPersist = reject; });
  session.setPersistCallback(() => { startPersist(); return persisted; });
  const onUpdate = vi.fn();
  const mediaFile = {
    id: `audio-proxy-${outcome}`, name: 'source.wav', type: 'audio',
    file: new File(['audio'], 'source.wav', { type: 'audio/wav' }),
  } as MediaFile;

  const job = ensureAudioProxyForMediaFile(mediaFile, { onUpdate });
  await persistStarted;
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'generating', progress: 92 }));
  expect(onUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);

  if (outcome === 'success') {
    finishPersist(true);
    await job;
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', progress: 100 }));
  } else {
    const rejected = expect(job).rejects.toThrow(outcome === 'false' ? 'artifact batch' : 'Disk full');
    if (outcome === 'false') finishPersist(false);
    else rejectPersist(new Error('Disk full'));
    await rejected;
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', progress: 0, error: expect.any(String) }));
    expect(onUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
    session.setPersistCallback(async () => true);
    await ensureAudioProxyForMediaFile(mediaFile, { onUpdate });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', progress: 100 }));
  }
});

it('revokes an unpublished proxy URL after a failed batch and allows a fresh retry', async () => {
  const session = createSession();
  session.setPersistCallback(async () => false);
  mocks.getSession.mockReturnValue(session);
  // The project closes while decoding; the fallback result is a temporary URL,
  // while the batch still belongs to the project in which decoding started.
  mocks.isProjectOpen.mockReturnValueOnce(true).mockReturnValue(false);
  mocks.hasProxyAudio.mockResolvedValue(false);
  mocks.decode.mockImplementationOnce(async () => {
    await session.writeEntry('CACHE_ARTIFACTS', 'pcm', 'decoded samples');
    return { duration: 1 } as AudioBuffer;
  }).mockResolvedValue({ duration: 1 } as AudioBuffer);
  const createUrl = vi.spyOn(URL, 'createObjectURL')
    .mockReturnValueOnce('blob:failed-proxy').mockReturnValueOnce('blob:retried-proxy');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const mediaFile = {
    id: 'audio-proxy-url-retry', name: 'source.wav', type: 'audio',
    file: new File(['audio'], 'source.wav', { type: 'audio/wav' }),
  } as MediaFile;
  const onUpdate = vi.fn();

  await expect(ensureAudioProxyForMediaFile(mediaFile, { onUpdate })).rejects.toThrow('artifact batch');
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:failed-proxy');
  expect(onUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));

  mocks.getSession.mockReturnValue(null);
  await ensureAudioProxyForMediaFile(mediaFile, { onUpdate });
  expect(mocks.decode).toHaveBeenCalledTimes(2);
  expect(createUrl).toHaveBeenCalledTimes(2);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', url: 'blob:retried-proxy' }));
  expect(revokeUrl).toHaveBeenCalledTimes(1);
});

it.each(['false', 'rejection'] as const)('keeps concurrent WAV outcomes independent when the second write returns %s', async (failureMode) => {
  const session = createSession();
  const persist = vi.fn(async () => true);
  session.setPersistCallback(persist);
  mocks.getSession.mockReturnValue(session);
  mocks.isProjectOpen.mockReturnValue(true);
  mocks.hasProxyAudio.mockResolvedValue(false);
  let artifactIndex = 0;
  mocks.decode.mockImplementation(async () => {
    await session.writeEntry('CACHE_ARTIFACTS', `pcm-${artifactIndex++}`, 'decoded samples');
    return { duration: 1 } as AudioBuffer;
  });
  let finishFirst!: (saved: boolean) => void;
  let finishSecond!: (saved: boolean) => void;
  let rejectSecond!: (error: unknown) => void;
  const firstWrite = new Promise<boolean>(resolve => { finishFirst = resolve; });
  const secondWrite = new Promise<boolean>((resolve, reject) => {
    finishSecond = resolve;
    rejectSecond = reject;
  });
  let bothWritesStarted!: () => void;
  const writesStarted = new Promise<void>(resolve => { bothWritesStarted = resolve; });
  let writeCount = 0;
  mocks.saveProxyAudio.mockImplementation((storageKey: string) => {
    if (++writeCount === 2) bothWritesStarted();
    return storageKey === 'parallel-audio-a' ? firstWrite : secondWrite;
  });
  const createMedia = (id: string) => ({
    id, name: `${id}.wav`, type: 'audio',
    file: new File(['audio'], `${id}.wav`, { type: 'audio/wav' }),
  }) as MediaFile;
  const firstUpdate = vi.fn();
  const secondUpdate = vi.fn();
  const first = ensureAudioProxyForMediaFile(createMedia('parallel-audio-a'), { onUpdate: firstUpdate });
  const second = ensureAudioProxyForMediaFile(createMedia('parallel-audio-b'), { onUpdate: secondUpdate });
  const secondOutcome = second.then(() => undefined, error => error);
  await writesStarted;
  expect(firstUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
  expect(secondUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);

  finishFirst(true);
  await first;
  expect(firstUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  expect(secondUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'generating', progress: 92 }));
  expect(session.isBatchingWrites).toBe(true);
  expect(persist).not.toHaveBeenCalled();

  const writeError = new Error('WAV storage unavailable');
  if (failureMode === 'false') finishSecond(false);
  else rejectSecond(writeError);
  expect(await secondOutcome).toBe(failureMode === 'false' ? undefined : writeError);
  expect(secondUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', progress: 0 }));
  expect(secondUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
  expect(firstUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
  expect(session.isBatchingWrites).toBe(false);
  expect(persist).toHaveBeenCalledTimes(1);
});

it('does not revoke a proxy URL already handed to a throwing ready callback', async () => {
  mocks.getSession.mockReturnValue(null);
  mocks.isProjectOpen.mockReturnValue(false);
  mocks.decode.mockResolvedValue({ duration: 1 } as AudioBuffer);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:published-proxy');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const callbackError = new Error('UI subscriber failed');
  let publishedUrl: string | undefined;
  const onUpdate = vi.fn((update: AudioProxyGenerationUpdate) => {
    if (update.status === 'ready') {
      publishedUrl = update.url;
      throw callbackError;
    }
  });
  const mediaFile = {
    id: 'audio-proxy-callback-failure', name: 'source.wav', type: 'audio',
    file: new File(['audio'], 'source.wav', { type: 'audio/wav' }),
  } as MediaFile;

  await expect(ensureAudioProxyForMediaFile(mediaFile, { onUpdate })).rejects.toBe(callbackError);
  expect(publishedUrl).toBe('blob:published-proxy');
  expect(revokeUrl).not.toHaveBeenCalled();
  expect(onUpdate.mock.calls.some(([update]) => update.status === 'error')).toBe(false);
});
