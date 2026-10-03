import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
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

import {
  ensureAudioProxyForMediaFile,
  type AudioProxyGenerationUpdate,
} from '../../src/services/audio/AudioProxyService';
import type { MediaFile } from '../../src/stores/mediaStore/types';

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

// Proxy generation no longer holds a project artifact write batch: the finished WAV is
// stored through saveProxyAudio, and only that write's own outcome decides readiness.
it.each(['success', 'false', 'rejection'] as const)('reports its own WAV save %s before declaring an audio proxy ready', async (outcome) => {
  mocks.isProjectOpen.mockReturnValue(true);
  mocks.hasProxyAudio.mockResolvedValue(false);
  mocks.decode.mockResolvedValue({ duration: 1 } as AudioBuffer);
  let startPersist!: () => void;
  const persistStarted = new Promise<void>(resolve => { startPersist = resolve; });
  let finishPersist!: (saved: boolean) => void;
  let rejectPersist!: (reason: unknown) => void;
  const persisted = new Promise<boolean>((resolve, reject) => { finishPersist = resolve; rejectPersist = reject; });
  mocks.saveProxyAudio.mockImplementationOnce(() => { startPersist(); return persisted; });
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
    if (outcome === 'false') {
      finishPersist(false);
      await job;
    } else {
      const rejected = expect(job).rejects.toThrow('Disk full');
      rejectPersist(new Error('Disk full'));
      await rejected;
    }
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', progress: 0, error: expect.any(String) }));
    expect(onUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
    mocks.saveProxyAudio.mockResolvedValue(true);
    await ensureAudioProxyForMediaFile(mediaFile, { onUpdate });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', progress: 100 }));
  }
});

it('does not hand out a proxy URL after a failed project save and allows a fresh retry', async () => {
  // The project closes after the failed save; the retry falls back to a temporary URL.
  let projectOpen = true;
  mocks.isProjectOpen.mockImplementation(() => projectOpen);
  mocks.hasProxyAudio.mockResolvedValue(false);
  mocks.saveProxyAudio.mockResolvedValue(false);
  mocks.decode.mockResolvedValue({ duration: 1 } as AudioBuffer);
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:retried-proxy');
  const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const mediaFile = {
    id: 'audio-proxy-url-retry', name: 'source.wav', type: 'audio',
    file: new File(['audio'], 'source.wav', { type: 'audio/wav' }),
  } as MediaFile;
  const onUpdate = vi.fn();

  await ensureAudioProxyForMediaFile(mediaFile, { onUpdate });
  expect(mocks.saveProxyAudio).toHaveBeenCalledTimes(1);
  expect(createUrl).not.toHaveBeenCalled();
  expect(onUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', error: 'Could not save audio proxy to project' }));

  projectOpen = false;
  await ensureAudioProxyForMediaFile(mediaFile, { onUpdate });
  expect(mocks.decode).toHaveBeenCalledTimes(2);
  expect(mocks.saveProxyAudio).toHaveBeenCalledTimes(1);
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready', url: 'blob:retried-proxy' }));
  expect(revokeUrl).not.toHaveBeenCalled();
});

it.each(['false', 'rejection'] as const)('keeps concurrent WAV outcomes independent when the second write returns %s', async (failureMode) => {
  mocks.isProjectOpen.mockReturnValue(true);
  mocks.hasProxyAudio.mockResolvedValue(false);
  mocks.decode.mockResolvedValue({ duration: 1 } as AudioBuffer);
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

  const writeError = new Error('WAV storage unavailable');
  if (failureMode === 'false') finishSecond(false);
  else rejectSecond(writeError);
  expect(await secondOutcome).toBe(failureMode === 'false' ? undefined : writeError);
  expect(secondUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error', progress: 0 }));
  expect(secondUpdate.mock.calls.some(([update]) => update.status === 'ready')).toBe(false);
  expect(firstUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ready' }));
});

it('does not revoke a proxy URL already handed to a throwing ready callback', async () => {
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
