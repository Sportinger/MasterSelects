import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceMonitor } from '../../src/components/preview/SourceMonitor';
import { runTimelinePlacementCommand } from '../../src/services/timelinePlacementCommands';
import { useMediaStore, type MediaFile } from '../../src/stores/mediaStore';

vi.mock('../../src/services/timelinePlacementCommands', () => ({
  clearTimelinePlacementCommandPreview: vi.fn(),
  runTimelinePlacementCommand: vi.fn().mockResolvedValue({ success: true }),
  showTimelinePlacementCommandPreview: vi.fn(),
}));

const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
};

const mockedRunTimelinePlacementCommand = runTimelinePlacementCommand as unknown as ReturnType<typeof vi.fn>;

type MockMediaState = {
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

describe('SourceMonitor edit commands', () => {
  beforeEach(() => {
    mediaState = {
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

  it('keeps source edit placement commands available for still sources', async () => {
    render(<SourceMonitor file={createImageFile()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Source edit commands')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTitle('Insert source at playhead'));
      await Promise.resolve();
    });

    expect(mockedRunTimelinePlacementCommand).toHaveBeenCalledWith('insert');
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
