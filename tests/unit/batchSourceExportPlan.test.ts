import { describe, expect, it } from 'vitest';
import { createDefaultExportSettings } from '../../src/stores/exportStore';
import {
  BatchSourceExportUnsupportedError,
  createBatchSourceExportPlan,
  getBatchSourceFrameRate,
  getBatchSourceResolution,
  mapBatchSourceVideoCodec,
  replaceBatchSourceOutputExtension,
} from '../../src/components/export/batch';

describe('batch source export planning', () => {
  it('maps application video codec names to MediaBunny codecs', () => {
    expect(mapBatchSourceVideoCodec('h264')).toBe('avc');
    expect(mapBatchSourceVideoCodec('h265')).toBe('hevc');
    expect(mapBatchSourceVideoCodec('vp9')).toBe('vp9');
    expect(mapBatchSourceVideoCodec('av1')).toBe('av1');
  });

  it('uses the configured custom resolution and frame rate', () => {
    const settings = {
      ...createDefaultExportSettings(),
      useCustomResolution: true,
      customWidth: 1440,
      customHeight: 1080,
      useCustomFps: true,
      customFps: 23.976,
    };

    expect(getBatchSourceResolution(settings)).toEqual({ width: 1440, height: 1080 });
    expect(getBatchSourceFrameRate(settings)).toBe(23.976);
  });

  it('replaces an existing extension and removes path/control characters', () => {
    expect(replaceBatchSourceOutputExtension('C:\\source\\My: clip.final.mov', '.mp4'))
      .toBe('My_ clip.final.mp4');
    expect(replaceBatchSourceOutputExtension('   ', 'webm')).toBe('export.webm');
  });

  it('creates an MP4 video plan with forced target properties', () => {
    const settings = {
      ...createDefaultExportSettings(),
      containerFormat: 'mp4' as const,
      videoCodec: 'h265' as const,
      bitrate: 24_000_000,
      includeAudio: true,
      audioBitrate: 320_000,
      audioSampleRate: 44100 as const,
    };

    expect(createBatchSourceExportPlan({
      mediaType: 'video',
      settings,
      outputName: 'camera-original.MOV',
    })).toMatchObject({
      kind: 'video',
      container: 'mp4',
      filename: 'camera-original.mp4',
      mimeType: 'video/mp4',
      videoCodec: 'hevc',
      videoBitrate: 24_000_000,
      includeAudio: true,
      audioCodec: 'aac',
      audioBitrate: 320_000,
      audioSampleRate: 44100,
    });
  });

  it('creates WAV, MP3, and browser-native audio plans', () => {
    const defaults = createDefaultExportSettings();

    expect(createBatchSourceExportPlan({
      mediaType: 'audio',
      settings: { ...defaults, audioOnlyFormat: 'wav' },
      outputName: 'mix.aiff',
    })).toMatchObject({ container: 'wav', audioCodec: 'pcm-s16', filename: 'mix.wav' });

    expect(createBatchSourceExportPlan({
      mediaType: 'audio',
      settings: { ...defaults, audioOnlyFormat: 'mp3', audioBitrate: 192_000 },
      outputName: 'mix.wav',
    })).toMatchObject({ container: 'mp3', audioCodec: 'mp3', filename: 'mix.mp3', audioBitrate: 192_000 });

    expect(createBatchSourceExportPlan({
      mediaType: 'audio',
      settings: { ...defaults, audioOnlyFormat: 'browser', containerFormat: 'mp4' },
      outputName: 'mix.wav',
    })).toMatchObject({ container: 'mp4', audioCodec: 'aac', filename: 'mix.m4a', mimeType: 'audio/mp4' });

    expect(createBatchSourceExportPlan({
      mediaType: 'audio',
      settings: { ...defaults, audioOnlyFormat: 'browser', containerFormat: 'webm' },
      outputName: 'mix.wav',
    })).toMatchObject({ container: 'webm', audioCodec: 'opus', filename: 'mix.webm', mimeType: 'audio/webm' });
  });

  it('treats an image sequence setting as one contained image frame', () => {
    const settings = {
      ...createDefaultExportSettings(),
      visualMode: 'image' as const,
      imageExportMode: 'sequence' as const,
      imageFormat: 'jpg' as const,
      imageQuality: 0.8,
    };

    expect(createBatchSourceExportPlan({
      mediaType: 'image',
      settings,
      outputName: 'still.png',
    })).toMatchObject({
      kind: 'image',
      format: 'jpg',
      filename: 'still.jpg',
      mimeType: 'image/jpeg',
      quality: 0.8,
      background: 'black',
    });
  });

  it('rejects GIF and WebM codec combinations that cannot be encoded', () => {
    const defaults = createDefaultExportSettings();

    expect(() => createBatchSourceExportPlan({
      mediaType: 'video',
      settings: { ...defaults, visualMode: 'gif' },
      outputName: 'clip.mov',
    })).toThrow(BatchSourceExportUnsupportedError);

    expect(() => createBatchSourceExportPlan({
      mediaType: 'video',
      settings: { ...defaults, containerFormat: 'webm', videoCodec: 'h264' },
      outputName: 'clip.mov',
    })).toThrow(/VP9 or AV1/);
  });
});
