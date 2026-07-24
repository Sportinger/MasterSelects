import { describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import {
  prepareMuscriptorAudio,
  type MuscriptorAudioPreparationDependencies,
} from '../../src/services/muscriptor/audioPreparation';

function clip(overrides: Partial<TimelineClip>): TimelineClip {
  return {
    id: 'audio-1',
    trackId: 'track-1',
    name: 'Píseň 测试.wav',
    file: new File(['audio'], 'Píseň 测试.wav', { type: 'audio/wav' }),
    startTime: 4,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    source: { type: 'audio', file: new File(['audio'], 'source.wav') },
    transform: {} as TimelineClip['transform'],
    effects: [],
    ...overrides,
  };
}

function dependencies(tempDirectory: string | null = 'C:\\Benutzer\\Müsic Temp\\muscriptor') {
  const nativeClient = {
    isConnected: vi.fn(() => true),
    connect: vi.fn(async () => true),
    getProjectRoot: vi.fn(async () => 'C:\\Project 测试'),
    createDir: vi.fn(async () => true),
    writeFileBinary: vi.fn(async () => true),
    deleteFile: vi.fn(async () => true),
    muscriptor: { status: vi.fn(async () => ({ temp_directory: tempDirectory })) },
  };
  const analysisBuffer = { duration: 7.5 } as AudioBuffer;
  const prepareInput = vi.fn(async () => ({
    mediaFileId: 'media-1',
    sourceFingerprint: 'source:fingerprint',
    clipAudioStateHash: 'processed:state',
    sourceBuffer: analysisBuffer,
    analysisBuffer,
    processed: true,
    decoderId: 'test',
    decoderVersion: '1',
    metadata: {},
  }));
  const values: MuscriptorAudioPreparationDependencies = {
    nativeClient,
    prepareInput,
    encodeWav: vi.fn(() => new Blob(['wav'], { type: 'audio/wav' })),
    createId: () => 'unicode-safe-id',
  };
  return { values, nativeClient, prepareInput };
}

describe('MuScriptor audio preparation', () => {
  it('resolves linked audible audio and stages processed WAV in helper temp storage', async () => {
    const audio = clip({ id: 'audio-linked', startTime: 9 });
    const video = clip({
      id: 'video-1',
      name: 'video.mp4',
      file: new File(['video'], 'video.mp4', { type: 'video/mp4' }),
      source: { type: 'video', file: new File(['video'], 'video.mp4') },
      linkedClipId: audio.id,
      startTime: 9,
    });
    const { values, nativeClient, prepareInput } = dependencies();

    const result = await prepareMuscriptorAudio(video, {
      clips: [video, audio],
      dependencies: values,
    });

    expect(prepareInput).toHaveBeenCalledWith(expect.objectContaining({
      clip: audio,
      needsProcessed: true,
    }));
    expect(result).toMatchObject({
      audioPath: 'C:\\Benutzer\\Müsic Temp\\muscriptor\\muscriptor-unicode-safe-id.wav',
      sourceFingerprint: 'source:fingerprint',
      processingStateHash: 'processed:state',
      audioClipId: 'audio-linked',
      timelineStart: 9,
      duration: 7.5,
    });
    expect(nativeClient.writeFileBinary).toHaveBeenCalledWith(result.audioPath, expect.any(Blob));

    await result.cleanup?.();
    await result.cleanup?.();
    expect(nativeClient.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to a project-local provider temp directory', async () => {
    const { values, nativeClient } = dependencies(null);
    const audio = clip({});
    const result = await prepareMuscriptorAudio(audio, { clips: [audio], dependencies: values });

    expect(result.audioPath).toBe(
      'C:\\Project 测试\\.masterselects\\tmp\\muscriptor\\muscriptor-unicode-safe-id.wav',
    );
    expect(nativeClient.createDir).toHaveBeenCalledWith(
      'C:\\Project 测试\\.masterselects\\tmp\\muscriptor',
      true,
    );
  });

  it('retries in ProjectRoot when an upgraded helper still rejects provider temp', async () => {
    const audio = clip({});
    const { values, nativeClient } = dependencies();
    nativeClient.createDir.mockImplementation(async path => path.includes('.masterselects'));

    const result = await prepareMuscriptorAudio(audio, { clips: [audio], dependencies: values });

    expect(nativeClient.createDir).toHaveBeenNthCalledWith(
      1,
      'C:\\Benutzer\\Müsic Temp\\muscriptor',
      true,
    );
    expect(result.audioPath).toContain('C:\\Project 测试\\.masterselects\\tmp\\muscriptor');
  });
});
