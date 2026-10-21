import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installInProcessWaveformWorker } from '../../helpers/inProcessWaveformWorker';

const env = vi.hoisted(() => ({ writable: true, putError: null as Error | null, puts: 0 }));

vi.mock('../../../src/services/project/repository/transaction/editorMutationRuntime', () => ({
  getEditorRepositorySession: () => ({ descriptor: { repositoryId: 'repo-1' } }),
}));
vi.mock('../../../src/services/project/repository/transaction/editorWriteAvailability', () => ({
  isEditorRepositoryWritable: () => env.writable,
  subscribeEditorWriteAvailability: () => () => undefined,
}));
vi.mock('../../../src/services/audio/currentAudioArtifactStore', async () => {
  const { ArtifactStore, MemoryArtifactStorageAdapter } = await import('../../../src/artifacts');
  const { AudioArtifactStore } = await import('../../../src/services/audio/AudioArtifactStore');
  class RefusingAdapter extends MemoryArtifactStorageAdapter {
    async writeArtifact(...args: Parameters<MemoryArtifactStorageAdapter['writeArtifact']>): Promise<void> {
      env.puts += 1;
      if (env.putError) throw env.putError;
      return super.writeArtifact(...args);
    }
  }
  return { createCurrentAudioArtifactStore: () => new AudioArtifactStore(new ArtifactStore(new RefusingAdapter())) };
});

import { generateTimelineWaveformAnalysisForFile } from '../../../src/services/audio/timelineWaveformPyramidCache';
import { getCachedTimelineWaveformPyramid } from '../../../src/services/audio/timelineWaveformPyramidLoading';
import {
  getDeferredPyramidCount,
  resetDeferredPyramidsForTest,
} from '../../../src/services/audio/waveformPyramid/deferredPyramidPersistence';
import { Logger } from '../../../src/services/logger';
import { getFolderAccessPause, resetFolderAccessPause } from '../../../src/services/project/folderAccess/folderAccessPause';

installInProcessWaveformWorker();

function mockAudio(samples: number): void {
  const data = Float32Array.from({ length: samples }, (_, index) => Math.sin(index / 20));
  const buffer = {
    numberOfChannels: 1, sampleRate: 48_000, length: data.length, duration: data.length / 48_000,
    getChannelData: () => data,
    copyFromChannel: (destination: Float32Array, _channel: number, offset = 0) => destination.set(data.subarray(offset, offset + destination.length)),
  } as unknown as AudioBuffer;
  class MockAudioContext {
    decodeAudioData = vi.fn(async () => buffer);
    close = vi.fn().mockResolvedValue(undefined);
  }
  (globalThis as { AudioContext?: unknown }).AudioContext = MockAudioContext;
}

function audioFile(name: string): File {
  const bytes = new Uint8Array([1, 2, 3, name.length]).buffer;
  return { name, size: bytes.byteLength, lastModified: 7, type: 'audio/wav', arrayBuffer: vi.fn(async () => bytes.slice(0)) } as unknown as File;
}

describe('waveform pyramid without project write access', () => {
  beforeEach(() => {
    env.writable = true; env.putError = null; env.puts = 0;
    resetFolderAccessPause();
    Logger.clear();
    mockAudio(48_000);
  });
  afterEach(() => {
    resetDeferredPyramidsForTest();
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it('computes the pyramid in memory in a read-only tab instead of falling back to the legacy waveform', async () => {
    env.writable = false;
    const result = await generateTimelineWaveformAnalysisForFile(audioFile('read-only.wav'), { mediaFileId: 'media-ro', reusePersisted: false });
    expect(result.pyramid).toBeDefined();
    expect(result.pyramidStorage).toBe('memory');
    expect(result.audioAnalysisRefs?.waveformPyramidId).toBeTruthy();
    expect(getCachedTimelineWaveformPyramid(result.audioAnalysisRefs!.waveformPyramidId)).toBe(result.pyramid);
    expect(env.puts).toBe(0);
    expect(getDeferredPyramidCount()).toBe(1);
    expect(Logger.getBuffer('WARN').filter(entry => entry.module === 'TimelineWaveformPyramid')).toEqual([]);
  });

  it('keeps the pyramid in memory when folder access pauses during storage', async () => {
    env.putError = Object.assign(new Error('The request is not allowed by the user agent'), { name: 'RepositoryError', code: 'access' });
    const result = await generateTimelineWaveformAnalysisForFile(audioFile('paused.wav'), { mediaFileId: 'media-paused', reusePersisted: false });
    expect(result.pyramid).toBeDefined();
    expect(result.pyramidStorage).toBe('memory');
    expect(env.puts).toBeGreaterThan(0);
    expect(getDeferredPyramidCount()).toBe(1);
    // The refused write marks the project folder paused, so Re-allow resumes the save.
    expect(getFolderAccessPause().project).toBe(true);
    expect(Logger.getBuffer('WARN').filter(entry => entry.module === 'TimelineWaveformPyramid')).toEqual([]);
  });

  it('still reports a real storage failure and falls back to the legacy waveform', async () => {
    env.putError = new Error('disk exploded');
    const result = await generateTimelineWaveformAnalysisForFile(audioFile('broken.wav'), { mediaFileId: 'media-broken', reusePersisted: false });
    expect(result.pyramid).toBeUndefined();
    expect(getDeferredPyramidCount()).toBe(0);
    expect(Logger.getBuffer('WARN').some(entry => entry.module === 'TimelineWaveformPyramid')).toBe(true);
  });
});
