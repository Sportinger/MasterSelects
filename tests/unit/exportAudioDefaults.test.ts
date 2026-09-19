import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useExportStore } from '../../src/stores/exportStore';

describe('export audio defaults', () => {
  beforeEach(() => {
    useExportStore.getState().reset();
  });

  afterEach(() => {
    useExportStore.getState().reset();
  });

  it('defaults browser video export to AAC-compatible 192 kbps audio', () => {
    expect(useExportStore.getState().settings).toMatchObject({
      encoder: 'webcodecs',
      containerFormat: 'mp4',
      audioBitrate: 192_000,
    });
  });

  it('migrates unsupported saved browser bitrates while retaining non-WebCodecs values', () => {
    useExportStore.getState().setSettings({ audioBitrate: 320_000 });
    expect(useExportStore.getState().settings.audioBitrate).toBe(192_000);

    useExportStore.getState().setSettings({
      encoder: 'ffmpeg',
      videoEnabled: true,
      audioBitrate: 320_000,
    });
    expect(useExportStore.getState().settings.audioBitrate).toBe(320_000);

    useExportStore.getState().setSettings({
      encoder: 'webcodecs',
      videoEnabled: false,
      audioOnlyFormat: 'mp3',
      audioBitrate: 320_000,
    });
    expect(useExportStore.getState().settings.audioBitrate).toBe(320_000);
  });
});
