import { describe, expect, it, vi } from 'vitest';
import {
  createAudioRecordingService,
  FallbackAudioRecordingCaptureBackend,
  type AudioRecordingCapture,
  type AudioRecordingCaptureBackend,
  type AudioRecordingRecoveryChunkInput,
  type AudioRecordedAsset,
  type AudioRecordingRecoveryBlobStore,
  type AudioRecordingStorageManager,
} from '../../../src/services/audio/AudioRecordingService';
import type { AudioRecordingRecoveryAssetRef, AudioRecordingRecoveryChunkRef } from '../../../src/types/audio';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class MemoryRecoveryBlobStore implements AudioRecordingRecoveryBlobStore {
  readonly blobs = new Map<string, Blob>();
  readonly deletedRefs: string[] = [];

  async putAsset(asset: AudioRecordedAsset): Promise<AudioRecordingRecoveryAssetRef> {
    const artifactId = `artifact-${asset.id}`;
    this.blobs.set(artifactId, asset.blob);
    return {
      id: asset.id,
      artifactId,
      inputDeviceId: asset.inputDeviceId,
      trackIds: asset.trackIds,
      fileName: asset.file.name,
      mimeType: asset.mimeType,
      sourceMimeType: asset.sourceMimeType,
      duration: asset.duration,
      startTime: asset.startTime,
      startedAt: asset.startedAt,
      stoppedAt: asset.stoppedAt,
      sampleRate: asset.sampleRate,
      channelCount: asset.channelCount,
      chunkCount: asset.chunkCount,
    };
  }

  async getAsset(assetRef: AudioRecordingRecoveryAssetRef): Promise<Blob | null> {
    return this.blobs.get(assetRef.artifactId) ?? null;
  }

  async putChunk(chunk: AudioRecordingRecoveryChunkInput): Promise<AudioRecordingRecoveryChunkRef> {
    const artifactId = `chunk-${chunk.sessionId}-${chunk.inputDeviceId ?? 'default'}-${chunk.chunkIndex}`;
    this.blobs.set(artifactId, chunk.blob);
    return {
      artifactId,
      inputDeviceId: chunk.inputDeviceId,
      trackIds: chunk.trackIds,
      chunkIndex: chunk.chunkIndex,
      kind: chunk.kind,
      mimeType: chunk.mimeType,
      startedAt: chunk.startedAt,
      startTime: chunk.startTime,
      timeStart: chunk.timeStart,
      duration: chunk.duration,
      sampleRate: chunk.sampleRate,
      channelCount: chunk.channelCount,
      frameCount: chunk.frameCount,
    };
  }

  async getChunk(chunkRef: AudioRecordingRecoveryChunkRef): Promise<Blob | null> {
    return this.blobs.get(chunkRef.artifactId) ?? null;
  }

  async deleteRef(artifactId: string): Promise<void> {
    this.deletedRefs.push(artifactId);
    this.blobs.delete(artifactId);
  }
}

function createBackend(capture?: Partial<AudioRecordingCapture>): AudioRecordingCaptureBackend {
  return {
    start: vi.fn(async () => ({
      mimeType: 'audio/webm',
      stop: vi.fn(async () => ({
        blob: new Blob(['recording'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        chunkCount: 1,
        duration: 2.5,
      })),
      cancel: vi.fn(async () => undefined),
      ...capture,
    })),
  };
}

describe('AudioRecordingService', () => {
  it('warns and requests persistent storage before long recovery-backed recordings', async () => {
    const persist = vi.fn(async () => false);
    const persisted = vi.fn(async () => false);
    const storageManager: AudioRecordingStorageManager = {
      estimate: vi.fn(async () => ({
        usage: 900 * 1024 * 1024,
        quota: 1024 * 1024 * 1024,
      })),
      persist,
      persisted,
    };
    const service = createAudioRecordingService({
      backend: createBackend(),
      encodeToWav: false,
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      storageManager,
      now: vi.fn().mockReturnValue(1000),
    });

    const snapshot = await service.start({
      targets: [
        { trackId: 'audio-1', inputDeviceId: 'input-a' },
        { trackId: 'audio-2', inputDeviceId: 'input-b' },
      ],
      startTime: 0,
    });

    expect(storageManager.estimate).toHaveBeenCalledTimes(1);
    expect(persisted).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(snapshot.storageWarnings?.map(warning => warning.code)).toEqual([
      'storage-quota-low',
      'storage-persistence-denied',
    ]);
    expect(snapshot.storageWarnings?.[0]).toMatchObject({
      severity: 'warning',
      persistRequested: true,
      persistGranted: false,
    });

    await service.cancel();
  });

  it('keeps successful persistent storage requests visible as recording info', async () => {
    const storageManager: AudioRecordingStorageManager = {
      estimate: vi.fn(async () => ({
        usage: 100 * 1024 * 1024,
        quota: 2 * 1024 * 1024 * 1024,
      })),
      persist: vi.fn(async () => true),
      persisted: vi.fn(async () => false),
    };
    const service = createAudioRecordingService({
      backend: createBackend(),
      encodeToWav: false,
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      storageManager,
      now: vi.fn().mockReturnValue(1000),
    });

    const snapshot = await service.start({
      targets: [{ trackId: 'audio-1' }],
      startTime: 0,
    });

    expect(snapshot.storageWarnings).toEqual([
      expect.objectContaining({
        code: 'storage-persistence-granted',
        severity: 'info',
        persistRequested: true,
        persistGranted: true,
      }),
    ]);

    await service.cancel();
  });

  it('reuses the same snapshot object while recording state and recovery metadata are unchanged', async () => {
    const service = createAudioRecordingService({
      backend: createBackend(),
      encodeToWav: false,
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: vi.fn().mockReturnValue(1000),
    });

    await service.start({
      targets: [{ trackId: 'audio-1', trackName: 'Audio 1' }],
      startTime: 12,
    });

    const first = service.getSnapshot();
    const second = service.getSnapshot();

    expect(second).toBe(first);
    expect(second.recoveryEntries).toBe(first.recoveryEntries);
  });

  it('starts, stops, and keeps stopped recovery metadata until commit succeeds', async () => {
    const storage = new MemoryStorage();
    const backend = createBackend();
    const service = createAudioRecordingService({
      backend,
      encodeToWav: false,
      recoveryStorage: storage,
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: vi.fn()
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(3500),
    });

    const started = await service.start({
      targets: [{ trackId: 'audio-1', trackName: 'Audio 1' }],
      startTime: 12,
    });

    expect(started.phase).toBe('recording');
    expect(service.listRecoveryEntries()).toEqual([
      expect.objectContaining({
        targetTrackIds: ['audio-1'],
        startTime: 12,
        status: 'active',
      }),
    ]);

    const result = await service.stop();

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      trackIds: ['audio-1'],
      duration: 2.5,
      startTime: 12,
      sourceMimeType: 'audio/webm',
      chunkCount: 1,
    });
    expect(result.assets[0]?.file.name).toMatch(/\.webm$/);
    expect(service.getSnapshot().phase).toBe('complete');
    expect(service.listRecoveryEntries()).toEqual([
      expect.objectContaining({
        targetTrackIds: ['audio-1'],
        startTime: 12,
        status: 'stopped',
      }),
    ]);
  });

  it('commits recorded files through media import, timeline clip creation, and analysis jobs', async () => {
    const storage = new MemoryStorage();
    const service = createAudioRecordingService({
      backend: createBackend(),
      encodeToWav: false,
      recoveryStorage: storage,
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: vi.fn()
        .mockReturnValueOnce(2000)
        .mockReturnValueOnce(4500),
    });
    await service.start({
      targets: [{ trackId: 'audio-1' }, { trackId: 'audio-2' }],
      startTime: 4,
    });
    const result = await service.stop();
    const importFile = vi.fn(async (file: File) => ({
      id: 'media-recording',
      type: 'audio',
      name: file.name,
      file,
    }));
    const addClip = vi.fn(async (trackId: string) => `clip-${trackId}`);
    const generateWaveformForClip = vi.fn(async () => undefined);
    const generateLoudnessForClip = vi.fn(async () => undefined);

    const commit = await service.commitRecordingResult(result, {
      importFile,
      addClip,
      generateWaveformForClip,
      generateLoudnessForClip,
    });

    expect(importFile).toHaveBeenCalledTimes(1);
    expect(addClip).toHaveBeenCalledTimes(2);
    expect(addClip).toHaveBeenNthCalledWith(
      1,
      'audio-1',
      expect.any(File),
      4,
      2.5,
      'media-recording',
      'audio',
      expect.objectContaining({ name: expect.stringMatching(/^Recording /) }),
    );
    expect(addClip).toHaveBeenNthCalledWith(
      2,
      'audio-2',
      expect.any(File),
      4,
      2.5,
      'media-recording',
      'audio',
      expect.objectContaining({ name: expect.stringMatching(/^Recording /) }),
    );
    expect(generateWaveformForClip).toHaveBeenCalledWith('clip-audio-1');
    expect(generateWaveformForClip).toHaveBeenCalledWith('clip-audio-2');
    expect(generateLoudnessForClip).toHaveBeenCalledWith('clip-audio-1');
    expect(generateLoudnessForClip).toHaveBeenCalledWith('clip-audio-2');
    expect(commit.clips.map(clip => clip.clipId)).toEqual(['clip-audio-1', 'clip-audio-2']);
    expect(service.listRecoveryEntries()).toEqual([]);
  });

  it('can commit a stopped recording from persisted recovery assets', async () => {
    const storage = new MemoryStorage();
    const recoveryBlobStore = new MemoryRecoveryBlobStore();
    const service = createAudioRecordingService({
      backend: createBackend(),
      encodeToWav: false,
      recoveryStorage: storage,
      recoveryBlobStore,
      now: vi.fn()
        .mockReturnValueOnce(2000)
        .mockReturnValueOnce(4500),
    });
    await service.start({
      targets: [{ trackId: 'audio-1' }],
      startTime: 4,
    });
    const result = await service.stop();
    const stoppedEntry = service.listRecoveryEntries()[0];
    const importFile = vi.fn(async (file: File) => ({
      id: 'media-recovered-recording',
      type: 'audio',
      name: file.name,
      file,
    }));
    const addClip = vi.fn(async () => 'clip-recovered');

    const commit = await service.commitRecoveryEntry(result.sessionId, {
      importFile,
      addClip,
      generateWaveformForClip: vi.fn(async () => undefined),
      generateLoudnessForClip: vi.fn(async () => undefined),
    });

    expect(stoppedEntry).toMatchObject({
      status: 'stopped',
      assets: [expect.objectContaining({ artifactId: expect.stringMatching(/^artifact-/) })],
    });
    expect(importFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringMatching(/\.webm$/) }),
      null,
      expect.objectContaining({ forceCopyToProject: true }),
    );
    expect(addClip).toHaveBeenCalledWith(
      'audio-1',
      expect.any(File),
      4,
      2.5,
      'media-recovered-recording',
      'audio',
      expect.objectContaining({ name: expect.stringMatching(/^Recording /) }),
    );
    expect(commit.clips.map(clip => clip.clipId)).toEqual(['clip-recovered']);
    expect(recoveryBlobStore.deletedRefs).toContain(stoppedEntry?.assets?.[0]?.artifactId);
    expect(service.listRecoveryEntries()).toEqual([]);
  });

  it('can recover active persisted chunks after a fresh service instance is created', async () => {
    const storage = new MemoryStorage();
    const recoveryBlobStore = new MemoryRecoveryBlobStore();
    const backend: AudioRecordingCaptureBackend = {
      start: vi.fn(async (input) => {
        await input.chunkSink?.writeChunk({
          sessionId: input.sessionId!,
          inputDeviceId: input.inputDeviceId,
          trackIds: input.trackIds ?? [],
          chunkIndex: 0,
          kind: 'media-recorder',
          blob: new Blob(['chunk-0'], { type: 'audio/webm' }),
          mimeType: 'audio/webm',
          startedAt: input.startedAt!,
          startTime: input.startTime ?? 0,
          timeStart: 0,
          duration: 1,
        });
        return {
          mimeType: 'audio/webm',
          stop: vi.fn(async () => ({
            blob: new Blob(['chunk-0'], { type: 'audio/webm' }),
            mimeType: 'audio/webm',
            chunkCount: 1,
            duration: 1,
          })),
          cancel: vi.fn(async () => undefined),
        };
      }),
    };
    const service = createAudioRecordingService({
      backend,
      encodeToWav: false,
      recoveryStorage: storage,
      recoveryBlobStore,
      now: () => 1000,
    });

    await service.start({
      sessionId: 'recording-session',
      targets: [{ trackId: 'audio-1' }],
      startTime: 3,
      startedAt: 1000,
    });
    const activeEntry = service.listRecoveryEntries()[0];
    expect(activeEntry).toMatchObject({
      status: 'active',
      chunks: [expect.objectContaining({ artifactId: 'chunk-recording-session-default-0' })],
    });

    const restoredService = createAudioRecordingService({
      backend: createBackend(),
      encodeToWav: false,
      recoveryStorage: storage,
      recoveryBlobStore,
      now: () => 3000,
    });
    const importFile = vi.fn(async (file: File) => ({
      id: 'media-recovered-chunk',
      type: 'audio',
      name: file.name,
      file,
    }));
    const addClip = vi.fn(async () => 'clip-recovered-chunk');

    const commit = await restoredService.commitRecoveryEntry('recording-session', {
      importFile,
      addClip,
      generateWaveformForClip: vi.fn(async () => undefined),
      generateLoudnessForClip: vi.fn(async () => undefined),
    });

    expect(addClip).toHaveBeenCalledWith(
      'audio-1',
      expect.any(File),
      3,
      1,
      'media-recovered-chunk',
      'audio',
      expect.objectContaining({ name: expect.stringMatching(/^Recovered Recording /) }),
    );
    expect(commit.clips.map(clip => clip.clipId)).toEqual(['clip-recovered-chunk']);
    expect(recoveryBlobStore.deletedRefs).toContain(activeEntry?.chunks?.[0]?.artifactId);
    expect(restoredService.listRecoveryEntries()).toEqual([]);
  });

  it('requires at least one armed target before recording starts', async () => {
    const service = createAudioRecordingService({
      backend: createBackend(),
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
    });

    await expect(service.start({ targets: [], startTime: 0 }))
      .rejects.toThrow('Arm at least one audio track');
  });

  it('cancels active captures and clears recovery metadata', async () => {
    const cancel = vi.fn(async () => undefined);
    const storage = new MemoryStorage();
    const service = createAudioRecordingService({
      backend: createBackend({ cancel }),
      recoveryStorage: storage,
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: () => 1000,
    });

    await service.start({ targets: [{ trackId: 'audio-1' }], startTime: 0 });
    await service.cancel();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().phase).toBe('idle');
    expect(service.listRecoveryEntries()).toEqual([]);
  });

  it('falls back to the next capture backend when the preferred backend cannot start', async () => {
    const preferredBackend: AudioRecordingCaptureBackend = {
      start: vi.fn(async () => {
        throw new Error('AudioWorklet unavailable');
      }),
    };
    const fallbackBackend = createBackend();
    const service = createAudioRecordingService({
      backend: new FallbackAudioRecordingCaptureBackend([preferredBackend, fallbackBackend]),
      encodeToWav: false,
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: vi.fn()
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(3000),
    });

    await service.start({ targets: [{ trackId: 'audio-1' }], startTime: 0 });
    const result = await service.stop();

    expect(preferredBackend.start).toHaveBeenCalledTimes(1);
    expect(fallbackBackend.start).toHaveBeenCalledTimes(1);
    expect(result.assets[0]?.sourceMimeType).toBe('audio/webm');
  });

  it('cancels already-started captures when a later input group fails to start', async () => {
    const cancelStartedCapture = vi.fn(async () => undefined);
    const backend: AudioRecordingCaptureBackend = {
      start: vi.fn(async (input) => {
        if (input.inputDeviceId === 'input-b') {
          throw new Error('Second input failed');
        }
        return {
          mimeType: 'audio/webm',
          stop: vi.fn(async () => ({
            blob: new Blob(['recording'], { type: 'audio/webm' }),
            mimeType: 'audio/webm',
            chunkCount: 1,
          })),
          cancel: cancelStartedCapture,
        };
      }),
    };
    const service = createAudioRecordingService({
      backend,
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: () => 1000,
    });

    await expect(service.start({
      targets: [
        { trackId: 'audio-1', inputDeviceId: 'input-a' },
        { trackId: 'audio-2', inputDeviceId: 'input-b' },
      ],
      startTime: 0,
    })).rejects.toThrow('Second input failed');

    expect(cancelStartedCapture).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toMatchObject({
      phase: 'error',
      lastError: 'Second input failed',
    });
  });

  it('keeps AudioWorklet WAV captures as WAV and preserves capture metadata', async () => {
    const backend = createBackend({
      mimeType: 'audio/wav',
      stop: vi.fn(async () => ({
        blob: new Blob(['pcm'], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        chunkCount: 4,
        duration: 1.25,
        sampleRate: 48000,
        channelCount: 2,
      })),
    });
    const service = createAudioRecordingService({
      backend,
      encodeToWav: true,
      recoveryStorage: new MemoryStorage(),
      recoveryBlobStore: new MemoryRecoveryBlobStore(),
      now: vi.fn()
        .mockReturnValueOnce(2000)
        .mockReturnValueOnce(3250),
    });

    await service.start({ targets: [{ trackId: 'audio-1' }], startTime: 8 });
    const result = await service.stop();

    expect(result.assets[0]).toMatchObject({
      duration: 1.25,
      sampleRate: 48000,
      channelCount: 2,
      sourceMimeType: 'audio/wav',
      mimeType: 'audio/wav',
      chunkCount: 4,
    });
    expect(result.assets[0]?.file.name).toMatch(/\.wav$/);
  });

  it('waits for punch-in before starting the capture backend', async () => {
    vi.useFakeTimers();
    try {
      let timelineTime = 3;
      const backend = createBackend();
      const service = createAudioRecordingService({
        backend,
        encodeToWav: false,
        recoveryStorage: new MemoryStorage(),
        recoveryBlobStore: new MemoryRecoveryBlobStore(),
        now: () => 1000,
      });

      const snapshot = await service.start({
        targets: [{ trackId: 'audio-1' }],
        startTime: 5,
        punchInTime: 5,
        punchOutTime: 8,
        getTimelineTime: () => timelineTime,
      });

      expect(snapshot.phase).toBe('waiting-for-punch');
      expect(backend.start).not.toHaveBeenCalled();

      timelineTime = 5;
      await vi.advanceTimersByTimeAsync(60);

      expect(backend.start).toHaveBeenCalledTimes(1);
      expect(service.getSnapshot()).toMatchObject({
        phase: 'recording',
        startTime: 5,
        punchInTime: 5,
        punchOutTime: 8,
      });

      await service.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('warms input before punch-in but resumes capture at the punch point', async () => {
    vi.useFakeTimers();
    try {
      let timelineTime = 3;
      const resume = vi.fn();
      const backend = createBackend({ resume });
      const service = createAudioRecordingService({
        backend,
        encodeToWav: false,
        recoveryStorage: new MemoryStorage(),
        recoveryBlobStore: new MemoryRecoveryBlobStore(),
        now: vi.fn()
          .mockReturnValueOnce(1000)
          .mockReturnValueOnce(2000),
      });

      await service.start({
        targets: [{ trackId: 'audio-1' }],
        startTime: 5,
        punchInTime: 5,
        punchOutTime: 8,
        getTimelineTime: () => timelineTime,
      });

      timelineTime = 3.6;
      await vi.advanceTimersByTimeAsync(60);

      expect(backend.start).toHaveBeenCalledTimes(1);
      expect(backend.start).toHaveBeenCalledWith(expect.objectContaining({
        initiallyPaused: true,
        startTime: 5,
      }));
      expect(resume).not.toHaveBeenCalled();
      expect(service.getSnapshot().phase).toBe('warming-input');

      timelineTime = 5;
      await vi.advanceTimersByTimeAsync(60);

      expect(resume).toHaveBeenCalledWith({
        startedAt: 2000,
        startTime: 5,
      });
      expect(service.getSnapshot()).toMatchObject({
        phase: 'recording',
        startTime: 5,
        punchInTime: 5,
        punchOutTime: 8,
      });

      await service.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-stops at punch-out time and runs the punch-out callback', async () => {
    vi.useFakeTimers();
    try {
      let timelineTime = 0;
      const stop = vi.fn(async () => ({
        blob: new Blob(['recording'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        chunkCount: 1,
        duration: 1,
      }));
      const onPunchOut = vi.fn(async () => undefined);
      const service = createAudioRecordingService({
        backend: createBackend({ stop }),
        encodeToWav: false,
        recoveryStorage: new MemoryStorage(),
        recoveryBlobStore: new MemoryRecoveryBlobStore(),
        now: vi.fn()
          .mockReturnValueOnce(1000)
          .mockReturnValueOnce(2000),
      });

      await service.start({
        targets: [{ trackId: 'audio-1' }],
        startTime: 4,
        punchOutTime: 5,
        getTimelineTime: () => timelineTime,
        onPunchOut,
      });
      timelineTime = 5.01;
      await vi.advanceTimersByTimeAsync(60);

      expect(stop).toHaveBeenCalledTimes(1);
      expect(onPunchOut).toHaveBeenCalledTimes(1);
      expect(onPunchOut).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: expect.any(String),
        startTime: 4,
        assets: [expect.objectContaining({ duration: 1 })],
      }));
      expect(service.getSnapshot()).toMatchObject({
        phase: 'complete',
        punchOutTime: 5,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
