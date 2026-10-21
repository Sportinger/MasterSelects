import { describe, expect, it, vi } from 'vitest';
import { isMediaPlayInterruption } from '../../src/utils/mediaPlayInterruption';
import { isUndecodableAudioSourceError } from '../../src/stores/timeline/clip/clipAudioAnalysisShared';
import { AudioDecodeServiceError } from '../../src/services/audio/decode/errors';
import { createImageRetrySource, describeImageLoadFailure } from '../../src/services/compositionRender/imageLoadFailure';

// jsdom Blobs lack arrayBuffer(); give each File a readable header slice.
function fileWithHeader(bytes: number[], name: string, type = ''): File {
  const file = new File([new Uint8Array(bytes)], name, { type });
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer) } as unknown as Blob);
  return file;
}

describe('media runtime failure classification', () => {
  it('treats a play() superseded by pause() as benign, other errors not', () => {
    expect(isMediaPlayInterruption(new DOMException(
      'The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22', 'AbortError',
    ))).toBe(true);
    expect(isMediaPlayInterruption(new DOMException('play() failed', 'NotAllowedError'))).toBe(false);
    expect(isMediaPlayInterruption(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
  });

  it('classifies an undecodable audio source as a waveform warning, not a read failure', () => {
    expect(isUndecodableAudioSourceError(new AudioDecodeServiceError(
      'Audio decode runtime browser.decodeAudioData failed: Unable to decode audio data',
      { code: 'decode-failed', jobId: 'job' },
    ))).toBe(true);
    expect(isUndecodableAudioSourceError(new AudioDecodeServiceError('read failed', { code: 'source-read-failed', jobId: 'job' }))).toBe(false);
    expect(isUndecodableAudioSourceError(new Error('Unable to decode audio data'))).toBe(false);
  });

  it('retries a failed stored image URL once from the File and explains final failures', async () => {
    const createObjectURL = vi.fn(() => 'blob:fresh');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL }));
    const jpeg = fileWithHeader([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4], 'IMG.jpg', 'image/jpeg');

    const retry = createImageRetrySource({ url: 'blob:stale', file: jpeg, name: 'IMG.jpg' });
    expect(retry).toMatchObject({ url: 'blob:fresh', objectUrl: 'blob:fresh', file: jpeg });
    expect(createImageRetrySource(retry!)).toBeNull();

    await expect(describeImageLoadFailure(retry!)).resolves.toMatch(/IMG\.jpg \(image\/jpeg, .*could not be decoded/);
    const heic = fileWithHeader([0, 0, 0, 24, ...Array.from('ftypheic', c => c.charCodeAt(0)), 0, 0, 0, 0], 'IMG.jpg');
    await expect(describeImageLoadFailure({ url: 'blob:x', file: heic, name: 'IMG.jpg' })).resolves.toMatch(/HEIC\/HEIF/);
    const unreadable = new File(['x'], 'IMG.jpg');
    vi.spyOn(unreadable, 'slice').mockReturnValue({ arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')) } as unknown as Blob);
    await expect(describeImageLoadFailure({ url: 'blob:x', file: unreadable, name: 'IMG.jpg' })).resolves.toMatch(/no longer readable/);
    vi.unstubAllGlobals();
  });
});
