import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceMonitor } from '../../src/components/preview/SourceMonitor';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';

vi.mock('../../src/services/timelinePlacementCommands', () => ({
  clearTimelinePlacementCommandPreview: vi.fn(),
  runTimelinePlacementCommand: vi.fn().mockResolvedValue({ success: true }),
  showTimelinePlacementCommandPreview: vi.fn(),
}));

const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
};

type MockMediaState = {
  files: MediaFile[];
  importFile: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  setSourceMonitorFile: ReturnType<typeof vi.fn>;
  sourceMonitorCropRequestId: number;
  sourceMonitorInPoint: number | null;
  sourceMonitorOutPoint: number | null;
  setSourceMonitorInPoint: ReturnType<typeof vi.fn>;
  setSourceMonitorOutPoint: ReturnType<typeof vi.fn>;
  clearSourceMonitorInOut: ReturnType<typeof vi.fn>;
};

let mediaState: MockMediaState;
let getCanvasContextSpy: ReturnType<typeof vi.spyOn>;

function createImageFile(): MediaFile {
  return {
    id: 'image-1',
    name: 'Still.png',
    type: 'image',
    parentId: null,
    createdAt: 1,
    file: new File(['image'], 'Still.png', { type: 'image/png' }),
    url: 'blob:still',
    width: 1920,
    height: 1080,
  };
}

function createVideoFile(): MediaFile {
  return {
    id: 'video-1',
    name: 'Clip.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
    url: 'blob:video',
    duration: 12,
    width: 1920,
    height: 1080,
  };
}

function createAudioFile(): MediaFile {
  return {
    id: 'audio-1',
    name: 'Voice.wav',
    type: 'audio',
    parentId: null,
    createdAt: 1,
    file: new File(['audio'], 'Voice.wav', { type: 'audio/wav' }),
    url: 'blob:voice',
    duration: 20,
    waveform: [0.1, 0.4, 1, 0.2],
    waveformChannels: [
      [0.1, 0.4, 1, 0.2],
      [0.08, 0.35, 0.9, 0.16],
    ],
    waveformStatus: 'ready',
    waveformProgress: 100,
  };
}

function setImageMetrics(image: HTMLImageElement): void {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 800 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 600 });
  Object.defineProperty(image, 'width', { configurable: true, value: 400 });
  Object.defineProperty(image, 'height', { configurable: true, value: 300 });
}

function transformNumbers(element: HTMLElement): { panX: number; panY: number; scale: number } {
  const match = element.style.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/);
  if (!match) throw new Error(`Unexpected transform: ${element.style.transform}`);
  return {
    panX: Number(match[1]),
    panY: Number(match[2]),
    scale: Number(match[3]),
  };
}

describe('SourceMonitor edit commands', () => {
  beforeEach(() => {
    mediaState = {
      files: [],
      importFile: vi.fn(),
      setSelection: vi.fn(),
      setSourceMonitorFile: vi.fn(),
      sourceMonitorCropRequestId: 0,
      sourceMonitorInPoint: null,
      sourceMonitorOutPoint: null,
      setSourceMonitorInPoint: vi.fn(),
      setSourceMonitorOutPoint: vi.fn(),
      clearSourceMonitorInOut: vi.fn(),
    };
    mockedUseMediaStore.mockImplementation((selector: (state: typeof mediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockReturnValue(mediaState);
    getCanvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      get fillStyle() {
        return '';
      },
      set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
      get globalAlpha() {
        return 1;
      },
      set globalAlpha(_value: number) {},
    }) as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    getCanvasContextSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('hides source timing while keeping crop and command controls for still sources', async () => {
    render(<SourceMonitor file={createImageFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByLabelText('Source timeline')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Set source In')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Set source Out')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Play')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crop image' })).toBeInTheDocument();
    expect(screen.getByLabelText('Source edit commands')).toBeInTheDocument();
  });

  it('lets Space continue to the normal timeline handler for still sources', async () => {
    render(<SourceMonitor file={createImageFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const downstream = vi.fn();
    window.addEventListener('keydown', downstream, true);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });

    window.dispatchEvent(event);
    window.removeEventListener('keydown', downstream, true);

    expect(event.defaultPrevented).toBe(false);
    expect(downstream).toHaveBeenCalled();
  });

  it('zooms still source preview with the mouse wheel', async () => {
    const { container } = render(<SourceMonitor file={createImageFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const media = container.querySelector('.source-monitor-media') as HTMLElement;
    const image = container.querySelector('.source-monitor-image') as HTMLImageElement;
    media.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 300 } as DOMRect));
    setImageMetrics(image);
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');

    await act(async () => {
      fireEvent.wheel(media, { clientX: 300, clientY: 200, deltaY: -250 });
      await Promise.resolve();
    });
    expect(transformNumbers(image)).toEqual({
      panX: expect.closeTo(-28.4025, 4),
      panY: expect.closeTo(-14.2013, 4),
      scale: expect.closeTo(1.2840, 4),
    });

    await act(async () => {
      fireEvent.wheel(media, { clientX: 300, clientY: 200, deltaY: 1000 });
      await Promise.resolve();
    });
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');

    await act(async () => {
      fireEvent.wheel(media, { clientX: 200, clientY: 150, deltaY: -5000 });
      await Promise.resolve();
    });
    expect(transformNumbers(image).scale).toBe(128);
  });

  it('pans still source preview with the middle mouse button', async () => {
    const { container } = render(<SourceMonitor file={createImageFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const media = container.querySelector('.source-monitor-media') as HTMLElement;
    const image = container.querySelector('.source-monitor-image') as HTMLImageElement;
    setImageMetrics(image);

    await act(async () => {
      fireEvent.pointerDown(media, { button: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(document, { clientX: 130, clientY: 85 });
      fireEvent.pointerUp(document);
      await Promise.resolve();
    });

    expect(image.style.transform).toBe('translate(30px, -15px) scale(1)');
  });

  it('zooms and pans video source preview', async () => {
    const { container } = render(<SourceMonitor file={createVideoFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const media = container.querySelector('.source-monitor-media') as HTMLElement;
    const video = container.querySelector('.source-monitor-video') as HTMLVideoElement;
    media.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 400, height: 300 } as DOMRect));
    expect(video.style.transform).toBe('translate(0px, 0px) scale(1)');

    await act(async () => {
      fireEvent.wheel(media, { clientX: 300, clientY: 200, deltaY: -5000 });
      await Promise.resolve();
    });
    expect(transformNumbers(video)).toEqual({
      panX: -12700,
      panY: -6350,
      scale: 128,
    });

    await act(async () => {
      fireEvent.pointerDown(media, { button: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(document, { clientX: 130, clientY: 85 });
      fireEvent.pointerUp(document);
      await Promise.resolve();
    });
    expect(transformNumbers(video)).toEqual({
      panX: -12670,
      panY: -6365,
      scale: 128,
    });

    await act(async () => {
      fireEvent.wheel(media, { clientX: 120, clientY: 90, deltaY: 99999 });
      await Promise.resolve();
    });
    expect(video.style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('renders audio sources with the source timeline and draggable in marker', async () => {
    render(<SourceMonitor file={createAudioFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Audio source player')).toBeInTheDocument();
    expect(screen.getByLabelText('Audio waveform')).toBeInTheDocument();
    const timeline = screen.getByLabelText('Source timeline');
    Object.defineProperty(timeline, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        right: 200,
        top: 0,
        bottom: 42,
        width: 200,
        height: 42,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      fireEvent.pointerDown(screen.getByLabelText('Drag source In'), { clientX: 50 });
      fireEvent.pointerUp(document, { clientX: 50 });
      await Promise.resolve();
    });

    expect(mockedUseMediaStore.getState().setSourceMonitorInPoint).toHaveBeenCalledWith(5);
  });

  it('shows the marked source range duration on the right timecode', async () => {
    mediaState.sourceMonitorInPoint = 4;
    mediaState.sourceMonitorOutPoint = 11;

    render(<SourceMonitor file={createAudioFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('0:07:00')).toBeInTheDocument();
  });
});
