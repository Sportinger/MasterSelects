import { afterEach, describe, expect, it, vi } from 'vitest';
import { multicamAnalyzer } from '../../src/services/multicamAnalyzer';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore';
import type { MultiCamSource } from '../../src/stores/multicamStore';
import { audioAnalyzer } from '../../src/services/audioAnalyzer';

vi.mock('../../src/services/audioAnalyzer', () => ({
  audioAnalyzer: {
    analyzeLevels: vi.fn(),
  },
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function stubObjectUrl(): {
  createObjectURL: ReturnType<typeof vi.fn<[Blob], string>>;
  revokeObjectURL: ReturnType<typeof vi.fn<[string], void>>;
} {
  const createObjectURL = vi.fn<[Blob], string>(() => 'blob:multicam-test');
  const revokeObjectURL = vi.fn<[string], void>();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectURL,
  });

  return { createObjectURL, revokeObjectURL };
}

function restoreObjectUrl(): void {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevokeObjectURL,
  });
}

function dispatchVideoEvent(listener: EventListenerOrEventListenerObject, type: string): void {
  const event = new Event(type);
  if (typeof listener === 'function') {
    listener(event);
    return;
  }

  listener.handleEvent(event);
}

function createMockVideo(outcome: 'loadedmetadata' | 'error'): HTMLVideoElement {
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const video = {
    duration: 0,
    src: '',
    muted: false,
    preload: '',
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn((name: string) => {
      if (name === 'src') {
        video.src = '';
      }
    }),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, listener);
      if (type === outcome) {
        queueMicrotask(() => {
          const activeListener = listeners.get(type);
          if (activeListener) {
            dispatchVideoEvent(activeListener, type);
          }
        });
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    }),
  };

  return video as unknown as HTMLVideoElement;
}

function mockVideoAndCanvas(video: HTMLVideoElement): void {
  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    ((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === 'video') {
        return video;
      }

      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({})),
        } as unknown as HTMLCanvasElement;
      }

      return realCreateElement(tagName, options);
    }) as typeof document.createElement
  );
}

function seedMediaStore(): void {
  const file = new File(['video'], 'camera.mp4', { type: 'video/mp4' });
  const mediaFile: MediaFile = {
    id: 'media-1',
    name: 'camera.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    file,
    url: '',
  };

  vi.mocked(useMediaStore.getState).mockReturnValue({
    files: [mediaFile],
  } as ReturnType<typeof useMediaStore.getState>);
}

function createCamera(): MultiCamSource {
  return {
    id: 'camera-1',
    mediaFileId: 'media-1',
    name: 'Camera 1',
    role: 'wide',
    syncOffset: 0,
    duration: 0,
  };
}

describe('multicamAnalyzer object URL lifetime', () => {
  afterEach(() => {
    restoreObjectUrl();
    vi.restoreAllMocks();
  });

  it('revokes the temporary video URL after successful analysis', async () => {
    const { createObjectURL, revokeObjectURL } = stubObjectUrl();
    mockVideoAndCanvas(createMockVideo('loadedmetadata'));
    seedMediaStore();
    vi.mocked(audioAnalyzer.analyzeLevels).mockResolvedValue(null);

    const result = await multicamAnalyzer.analyzeCamera(createCamera());

    expect(result).toEqual({ cameraId: 'camera-1', frames: [] });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:multicam-test');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the temporary video URL when metadata loading fails', async () => {
    const { revokeObjectURL } = stubObjectUrl();
    mockVideoAndCanvas(createMockVideo('error'));
    seedMediaStore();

    await expect(multicamAnalyzer.analyzeCamera(createCamera())).rejects.toThrow('Failed to load video');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:multicam-test');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
