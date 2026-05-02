import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  createImageSequenceZip,
  getImageSequenceFolderName,
  getImageSequenceFrameName,
} from '../../src/engine/export/ImageSequenceExporter';
import {
  createDefaultExportSettings,
  useExportStore,
} from '../../src/stores/exportStore';

function readBlobAsUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe('image sequence export helpers', () => {
  it('names frames with stable four-digit padding', () => {
    expect(getImageSequenceFrameName('shot', 0, 12, 'png')).toBe('shot_0001.png');
    expect(getImageSequenceFrameName('shot', 11, 12, '.webp')).toBe('shot_0012.webp');
    expect(getImageSequenceFrameName('', 0, 1, 'jpg')).toBe('export_0001.jpg');
    expect(getImageSequenceFrameName('bad:name*', 0, 1, 'png')).toBe('bad_name_0001.png');
  });

  it('expands padding for long sequences', () => {
    expect(getImageSequenceFrameName('shot', 9999, 12000, 'png')).toBe('shot_10000.png');
  });

  it('creates a sanitized sequence folder name', () => {
    expect(getImageSequenceFolderName('shot', 'png')).toBe('shot_png_sequence');
    expect(getImageSequenceFolderName('bad:name*', '.webp')).toBe('bad_name_webp_sequence');
  });

  it('creates a zip containing all sequence entries', async () => {
    const zip = createImageSequenceZip([
      { filename: 'shot_0001.txt', data: new Uint8Array([97]) },
      { filename: 'shot_0002.txt', data: new Uint8Array([98]) },
    ]);

    const bytes = await readBlobAsUint8Array(zip);
    const unzipped = unzipSync(bytes);
    expect(strFromU8(unzipped['shot_0001.txt'])).toBe('a');
    expect(strFromU8(unzipped['shot_0002.txt'])).toBe('b');
  });
});

describe('image sequence export settings', () => {
  it('defaults image export to a single frame', () => {
    expect(createDefaultExportSettings().imageExportMode).toBe('frame');
  });

  it('persists valid sequence mode and sanitizes invalid values', () => {
    useExportStore.getState().reset();
    useExportStore.getState().setSettings({ imageExportMode: 'sequence' });
    expect(useExportStore.getState().settings.imageExportMode).toBe('sequence');

    useExportStore.getState().replaceSettings({
      imageExportMode: 'bad-mode' as never,
    });
    expect(useExportStore.getState().settings.imageExportMode).toBe('frame');
  });
});
