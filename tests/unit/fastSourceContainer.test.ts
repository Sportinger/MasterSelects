import { describe, expect, it, vi } from 'vitest';
import {
  describeFastUnsupportedContainer,
  fastUnsupportedContainerMessage,
} from '../../src/engine/export/clipPreparation/fastSourceContainer';
import { loadFastExportSource } from '../../src/engine/export/clipPreparation/fastSourceLoading';
import type { WebCodecsPlayer } from '../../src/engine/WebCodecsPlayer';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/stores/timeline/types';

const bytes = (...values: Array<number | string>) => new Uint8Array(values.flatMap(value =>
  typeof value === 'string' ? [...value].map(char => char.charCodeAt(0)) : [value]));

describe('FAST export source container check', () => {
  it('accepts ISO-BMFF sources (MP4, MOV, files starting with moov or mdat)', () => {
    expect(describeFastUnsupportedContainer(bytes(0, 0, 0, 32, 'ftyp', 'isom'))).toBeNull();
    expect(describeFastUnsupportedContainer(bytes(0, 0, 0, 20, 'ftyp', 'qt  '))).toBeNull();
    expect(describeFastUnsupportedContainer(bytes(0, 0, 1, 0, 'moov', 0, 0, 0, 0))).toBeNull();
    expect(describeFastUnsupportedContainer(bytes(0, 0, 0, 8, 'wide', 0, 0, 0, 0))).toBeNull();
    expect(describeFastUnsupportedContainer(bytes(0, 0, 0, 24, 'styp', 'msdh'))).toBeNull();
  });

  it('leaves unrecognised headers to the parser instead of refusing them by a guess', () => {
    expect(describeFastUnsupportedContainer(new Uint8Array(12))).toBeNull();
    expect(describeFastUnsupportedContainer(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12))).toBeNull();
    // 0x47 alone is not a transport stream: its error and scrambling bits must be clear.
    expect(describeFastUnsupportedContainer(bytes(0x47, 0xff, 0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
  });

  it('names containers it cannot read', () => {
    expect(describeFastUnsupportedContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81))).toBe('WebM/Matroska');
    expect(describeFastUnsupportedContainer(bytes('RIFF', 0, 0, 0, 0, 'AVI '))).toBe('AVI');
    expect(describeFastUnsupportedContainer(bytes(0x47, 0x40, 0x11, 0x10, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('MPEG transport stream');
    expect(describeFastUnsupportedContainer(bytes('OggS', 0, 2, 0, 0, 0, 0, 0, 0))).toBe('Ogg');
  });

  it('tells the user which clip failed and which export to use instead', () => {
    const message = fastUnsupportedContainerMessage('WebM/Matroska', 'interview.webm');
    expect(message).toContain('WebM/Matroska');
    expect(message).toContain('"interview.webm"');
    expect(message).toMatch(/PRECISE \(HTMLVideo\)/);
    expect(message.startsWith('FAST export failed:')).toBe(true);
    expect(message).not.toMatch(/MP4Box/);
  });

  it('stops FAST source loading before the parser runs', async () => {
    const header = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81);
    const webm = new File([header], 'interview.webm', { type: 'video/webm' });
    // jsdom's Blob has no arrayBuffer(); the loader reads the first 12 bytes through slice().
    Object.defineProperty(webm, 'slice', { value: () => ({ arrayBuffer: async () => header.slice().buffer }) });
    const player = { loadArrayBuffer: vi.fn(), loadFileOnDemand: vi.fn() };
    const clip = { id: 'clip-1', name: 'interview.webm', mediaFileId: 'media-1' } as TimelineClip;
    const mediaFile = { id: 'media-1', name: 'interview.webm', type: 'video', file: webm } as MediaFile;

    await expect(loadFastExportSource(player as unknown as WebCodecsPlayer, clip, mediaFile, new Map()))
      .rejects.toThrow('FAST export failed: clip "interview.webm" is a WebM/Matroska file');
    expect(player.loadArrayBuffer).not.toHaveBeenCalled();
    expect(player.loadFileOnDemand).not.toHaveBeenCalled();
  });
});
