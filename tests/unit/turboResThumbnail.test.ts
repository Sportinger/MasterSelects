import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decodeTurboResOneFrame: vi.fn(),
}));

vi.mock('../../src/services/mediaRuntime/prores/turboResOneFrame', () => ({
  decodeTurboResOneFrame: mocks.decodeTurboResOneFrame,
}));

import { flags } from '../../src/engine/featureFlags';
import { createThumbnail } from '../../src/stores/mediaStore/helpers/thumbnailHelpers';

describe('TurboRes media thumbnails', () => {
  afterEach(() => {
    flags.turboResProRes = false;
    vi.restoreAllMocks();
    mocks.decodeTurboResOneFrame.mockReset();
  });

  it('decodes and closes a ProRes frame without creating an HTML video element', async () => {
    flags.turboResProRes = true;
    const close = vi.fn();
    const frame = {
      displayWidth: 1920,
      displayHeight: 1080,
      codedWidth: 1920,
      codedHeight: 1080,
      close,
    } as unknown as VideoFrame;
    mocks.decodeTurboResOneFrame.mockResolvedValue(frame);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'medium',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
      callback(new Blob(['thumbnail'], { type: type ?? 'image/webp' }));
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:prores-thumbnail');
    const createElement = vi.spyOn(document, 'createElement');
    const file = new File(['prores'], 'camera.mov', { type: 'video/quicktime' });

    const result = await createThumbnail(file, 'video', {
      videoCodecId: 'apch',
      duration: 10,
    });

    expect(result).toBe('blob:prores-thumbnail');
    expect(mocks.decodeTurboResOneFrame).toHaveBeenCalledWith(file, 'apch', 5, {
      providerOptions: { allowedOutputFormats: ['I420'] },
    });
    expect(drawImage).toHaveBeenCalledWith(frame, 0, 0, 256, 144);
    expect(close).toHaveBeenCalledOnce();
    expect(createElement.mock.calls.some(([tag]) => tag === 'video')).toBe(false);
  });
});
