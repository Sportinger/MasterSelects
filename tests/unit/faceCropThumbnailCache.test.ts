import { webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const projectFileServiceMocks = vi.hoisted(() => ({
  isProjectOpen: vi.fn(() => true),
  readFile: vi.fn<() => Promise<File | null>>(),
  writeFile: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: projectFileServiceMocks,
}));

import { getFaceCropThumbnail } from '../../src/services/faceAnalysis/faceCropThumbnailCache';

const box = { x: 0.2, y: 0.2, width: 0.25, height: 0.25 };

function installThumbnailGenerationDom(generatedThumbnail: Blob) {
  const originalCreateElement = document.createElement.bind(document);
  const video = originalCreateElement('video');
  const canvas = originalCreateElement('canvas');
  const context = {
    drawImage: vi.fn(),
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
  };

  Object.defineProperties(video, {
    currentTime: { configurable: true, value: 2, writable: true },
    duration: { configurable: true, value: 10 },
    readyState: { configurable: true, value: HTMLMediaElement.HAVE_FUTURE_DATA },
    videoHeight: { configurable: true, value: 1080 },
    videoWidth: { configurable: true, value: 1920 },
  });
  vi.spyOn(video, 'load').mockImplementation(() => undefined);
  vi.spyOn(video, 'pause').mockImplementation(() => undefined);
  vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(generatedThumbnail));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:face-source');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  const createElement = vi.spyOn(document, 'createElement');
  createElement.mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    if (tagName === 'video') return video;
    if (tagName === 'canvas') return canvas;
    return originalCreateElement(tagName, options);
  }) as typeof document.createElement);
  return { createElement, video };
}

describe('face crop thumbnail cache', () => {
  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    projectFileServiceMocks.isProjectOpen.mockReturnValue(true);
    projectFileServiceMocks.readFile.mockResolvedValue(null);
    projectFileServiceMocks.writeFile.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('persists a newly generated crop in the project cache', async () => {
    const generatedThumbnail = new Blob(['generated-face'], { type: 'image/jpeg' });
    installThumbnailGenerationDom(generatedThumbnail);

    const result = await getFaceCropThumbnail({
      file: new File(['video-a'], 'video-a.mp4', { lastModified: 100 }),
      timestamp: 2,
      box,
    });

    expect(result).toBe(generatedThumbnail);
    expect(projectFileServiceMocks.writeFile).toHaveBeenCalledWith(
      'CACHE_FACE_THUMBNAILS',
      expect.stringMatching(/^v1-[a-f0-9]{64}\.jpg$/),
      generatedThumbnail,
    );
  });

  it('restores a persisted crop without decoding the source video', async () => {
    const storedThumbnail = new File(
      ['stored-face'],
      'v1-stored.jpg',
      { type: 'image/jpeg' },
    );
    projectFileServiceMocks.readFile.mockResolvedValue(storedThumbnail);
    const createElement = vi.spyOn(document, 'createElement');
    const request = {
      file: new File(['video-b'], 'video-b.mp4', { lastModified: 200 }),
      timestamp: 3,
      box,
    };

    const first = await getFaceCropThumbnail(request);
    const second = await getFaceCropThumbnail(request);

    expect(first).toBe(storedThumbnail);
    expect(second).toBe(storedThumbnail);
    expect(projectFileServiceMocks.readFile).toHaveBeenCalledTimes(1);
    expect(projectFileServiceMocks.readFile).toHaveBeenCalledWith(
      'CACHE_FACE_THUMBNAILS',
      expect.stringMatching(/^v1-[a-f0-9]{64}\.jpg$/),
    );
    expect(createElement).not.toHaveBeenCalledWith('video');
    expect(projectFileServiceMocks.writeFile).not.toHaveBeenCalled();
  });

  it('reuses one decoded source session across distinct crops from the same file', async () => {
    const generatedThumbnail = new Blob(['generated-face'], { type: 'image/jpeg' });
    const { createElement, video } = installThumbnailGenerationDom(generatedThumbnail);
    const file = new File(['video-c'], 'video-c.mp4', { lastModified: 300 });

    await getFaceCropThumbnail({ file, timestamp: 2, box });
    await getFaceCropThumbnail({
      file,
      timestamp: 2,
      box: { ...box, x: 0.4 },
    });

    expect(createElement.mock.calls.filter(([tagName]) => tagName === 'video')).toHaveLength(1);
    expect(video.load).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
