import { describe, expect, it, vi, afterEach } from 'vitest';
import { unzlibSync } from 'fflate';
import { File as NodeFile } from 'node:buffer';
import { encodeRawImagePng } from '../../src/services/rawImage/rawImagePixels';
import { getRenderableImageBlob, getRawPhotoMetadata, isRawImageFile } from '../../src/services/rawImage/rawImageDecode';
import { detectMediaType } from '../../src/stores/timeline/helpers/mediaTypeHelpers';

afterEach(() => vi.unstubAllGlobals());

describe('Canon RAW image import', () => {
  it('classifies CR2 even when the OS supplies no MIME or octet-stream', () => {
    for (const type of ['', 'application/octet-stream', 'image/x-canon-cr2']) {
      const file = new File(['raw'], 'photo.CR2', { type });
      expect(isRawImageFile(file)).toBe(true);
      expect(detectMediaType(file)).toBe('image');
    }
    expect(isRawImageFile('photo.cr2.jpg')).toBe(false);
  });

  it('preserves ordinary browser image files', async () => {
    const jpeg = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });
    expect(await getRenderableImageBlob(jpeg)).toBe(jpeg);
  });

  it('deduplicates concurrent development, retains the original, and releases the worker', async () => {
    const instances: FakeWorker[] = [];
    class FakeWorker {
      onmessage?: (event: { data: { png: ArrayBuffer } }) => void;
      onerror?: unknown;
      terminate = vi.fn();
      constructor() { instances.push(this); }
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: { png: new Uint8Array([1, 2, 3]).buffer } })); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const file = new NodeFile(['sensor'], 'unique.CR2') as unknown as File;
    const requests = [getRenderableImageBlob(file), getRenderableImageBlob(file)];
    const [a, b] = await Promise.all(requests);
    expect(a).toBe(b); expect(a.type).toBe('image/png');
    expect(await file.text()).toBe('sensor');
    expect(await getRenderableImageBlob(file)).toBe(a);
    expect(instances).toHaveLength(1);
    expect(instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('reports a decode error and permits a subsequent retry', async () => {
    let attempt = 0;
    const terminate = vi.fn();
    class FakeWorker {
      onmessage?: (event: { data: { error?: string; png?: ArrayBuffer } }) => void;
      terminate = terminate;
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: ++attempt === 1 ? { error: 'Corrupt RAW' } : { png: new ArrayBuffer(3) } })); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const file = new NodeFile(['bad'], 'retry.CR2') as unknown as File;
    await expect(getRenderableImageBlob(file)).rejects.toThrow('Corrupt RAW');
    expect((await getRenderableImageBlob(file)).type).toBe('image/png');
    expect(terminate).toHaveBeenCalledTimes(2);
  });
  it('exposes decoded lens/exposure metadata without developing a second time', async () => {
    const metadata = { camera: 'EOS 5D Mark III', lens: 'EF24-105mm f/4L IS USM', focalLength: 40,
      aperture: 4, width: 5796, height: 3870 };
    const postMessage = vi.fn(function(this: { onmessage?: (event: unknown) => void }) {
      queueMicrotask(() => this.onmessage?.({ data: { png: new ArrayBuffer(3), metadata } }));
    });
    class FakeWorker { onmessage?: (event: unknown) => void; terminate = vi.fn(); postMessage = postMessage; }
    vi.stubGlobal('Worker', FakeWorker);
    const file = new NodeFile(['sensor'], 'metadata.CR2') as unknown as File;
    await getRenderableImageBlob(file);
    expect(await getRawPhotoMetadata(file)).toEqual(metadata);
    expect(postMessage).toHaveBeenCalledOnce();
    expect(await getRawPhotoMetadata(new File([], 'ordinary.jpg'))).toBeUndefined();
  });
});

describe('RAW PNG output', () => {
  it.each([1, 3, 4])('preserves every pixel and row for %i channels', colors => {
    const pixels = Uint8Array.from({ length: 2 * 3 * colors }, (_, i) => i * 13 % 256);
    const png = encodeRawImagePng(2, 3, colors, pixels);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(png.buffer);
    expect(header.getUint32(16)).toBe(2); expect(header.getUint32(20)).toBe(3);
    expect(png[25]).toBe(colors === 1 ? 0 : colors === 3 ? 2 : 6);
    const length = header.getUint32(33);
    const scanlines = unzlibSync(png.subarray(41, 41 + length));
    for (let row = 0; row < 3; row++) {
      const offset = row * (2 * colors + 1);
      expect(scanlines[offset]).toBe(0);
      expect(scanlines.subarray(offset + 1, offset + 1 + 2 * colors)).toEqual(pixels.subarray(row * 2 * colors, (row + 1) * 2 * colors));
    }
  });
  it('rejects inconsistent or excessive pixel dimensions', () => {
    expect(() => encodeRawImagePng(2, 2, 3, new Uint8Array(11))).toThrow('Invalid');
    expect(() => encodeRawImagePng(0, 2, 3, new Uint8Array())).toThrow('Invalid');
    expect(() => encodeRawImagePng(100_000, 100_000, 3, new Uint8Array())).toThrow('Invalid');
  });
});
