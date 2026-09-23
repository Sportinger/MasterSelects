import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '../../src/components/export/ExportPanel';
import { useExportRunController } from '../../src/components/export/useExportRunController';

const controlledVideoRunner = vi.hoisted(() => vi.fn());
vi.mock('../../src/components/export/runners/webCodecsExportRunner', () => ({
  runWebCodecsExport: controlledVideoRunner,
}));

type ExportPanelScenario = 'browser-gif' | 'ffmpeg-video' | 'still-image' | 'image-sequence';

const mockFactory = vi.hoisted(() => {
  type Scenario = 'browser-gif' | 'ffmpeg-video' | 'still-image' | 'image-sequence';

  const state = {
    scenario: 'browser-gif' as Scenario,
    throwRenderFrame: false,
    exportMismatch: false,
  };

  class MockExportFrameCaptureUnavailableError extends Error {
    readonly captureKind: 'rgba-pixels' | 'video-frame';

    constructor(captureKind: 'rgba-pixels' | 'video-frame') {
      super(`Export ${captureKind} capture was unavailable`);
      this.name = 'ExportFrameCaptureUnavailableError';
      this.captureKind = captureKind;
    }
  }

  class MockExportRenderSessionImpl {
    readonly runId: string;
    readonly signal = new AbortController().signal;
    begin = vi.fn();
    renderFrame = vi.fn(async () => {
      if (state.throwRenderFrame) {
        throw new Error('render failed');
      }
      return {
        kind: 'rgba-pixels' as const,
        pixels: new Uint8ClampedArray(32 * 18 * 4),
        width: 32,
        height: 18,
      };
    });
    cancel = vi.fn();
    dispose = vi.fn();

    constructor(options: { runId: string }) {
      this.runId = options.runId;
      sessionInstances.push(this);
    }
  }

  class MockFFmpegFrameRenderer {
    private cancelled = false;
    initialize = vi.fn(async () => undefined);
    buildLayersAtTime = vi.fn(async (time: number) => [{ id: `layer-${time}` }]);
    cleanup = vi.fn();
    cancel = vi.fn(() => {
      this.cancelled = true;
    });
    isCancelled = vi.fn(() => this.cancelled);
    shouldFinishEarly = vi.fn(() => false);
    finishEarly = vi.fn(() => { this.shouldFinishEarly.mockReturnValue(true); });
    getRuntimeRunId = vi.fn(() => 'runtime-run-a');

    constructor() {
      frameRendererInstances.push(this);
    }
  }

  class MockAudioExportPipeline {
    static hasAudioInRange = vi.fn(() => false);
    cancel = vi.fn();
    exportRawAudio = vi.fn(async () => null);
    exportAudio = vi.fn(async () => null);
  }

  const sessionInstances: MockExportRenderSessionImpl[] = [];
  const frameRendererInstances: MockFFmpegFrameRenderer[] = [];
  const setError = vi.fn();
  const setIsExporting = vi.fn();
  const setProgress = vi.fn();
  const setFfmpegProgress = vi.fn();
  const setExportPhase = vi.fn();
  const setExporter = vi.fn();
  const setCustomWidth = vi.fn();
  const setCustomHeight = vi.fn();
  const setUseCustomResolution = vi.fn();
  const handleResolutionChange = vi.fn();
  const setEncoder = vi.fn();
  const setContainerFormat = vi.fn();
  const handleFFmpegContainerChange = vi.fn();
  const handleFFmpegCodecChange = vi.fn();
  const setIncludeAlpha = vi.fn();
  const setVisualMode = vi.fn();
  const setVideoEnabled = vi.fn();
  const setIncludeAudio = vi.fn();
  const setAudioOnlyFormat = vi.fn();
  const downloadBlob = vi.fn();
  const encodeBrowserGif = vi.fn(() => new Blob(['gif'], { type: 'image/gif' }));
  const createImageSequenceZip = vi.fn(() => new Blob(['zip'], { type: 'application/zip' }));
  const ffmpegBridge = {
    isLoaded: vi.fn(() => true),
    cancel: vi.fn(),
    encode: vi.fn(async () => new Blob(['video'], { type: 'video/mp4' })),
  };
  const startExport = vi.fn();
  const setExportProgress = vi.fn();
  const endExport = vi.fn();

  const timelineState = {
    duration: 1,
    inPoint: null,
    outPoint: null,
    playheadPosition: 0.25,
    clips: [],
    selectedClipIds: new Set<string>(),
    primarySelectedClipId: null,
    tracks: [],
    masterAudioState: undefined,
    startExport,
    setExportProgress,
    endExport,
  };

  const exportStoreState = {
    presets: [],
    selectedPresetId: null,
    setSelectedPresetId: vi.fn(),
    savePreset: vi.fn(),
    updatePreset: vi.fn(),
    loadPreset: vi.fn(),
    setSettings: vi.fn(),
    settings: {
      useInOut: false,
    },
  };

  const checkBrowserGifExportSize = vi.fn(() => ({
    ok: true,
    frameCount: 1,
    rawFrameBytes: 32 * 18 * 4,
    estimatedOutputBytes: 1024,
    estimatedOutputMaxBytes: 2048,
  }));

  const createExportState = () => {
    const isImageScenario = state.scenario === 'still-image' || state.scenario === 'image-sequence';
    return {
      encoder: state.scenario === 'ffmpeg-video' ? 'ffmpeg' : 'webcodecs',
      setEncoder,
      width: state.exportMismatch ? 16 : 32,
      height: 18,
      customWidth: 32,
      setCustomWidth,
      customHeight: 18,
      setCustomHeight,
      useCustomResolution: false,
      setUseCustomResolution,
      fps: 1,
      setFps: vi.fn(),
      customFps: 1,
      setCustomFps: vi.fn(),
      useCustomFps: false,
      setUseCustomFps: vi.fn(),
      useInOut: false,
      setUseInOut: vi.fn(),
      filename: 'export',
      setFilename: vi.fn(),
      bitrate: 1_000_000,
      setBitrate: vi.fn(),
      containerFormat: 'mp4',
      setContainerFormat,
      videoCodec: 'h264',
      setVideoCodec: vi.fn(),
      codecSupport: {},
      rateControl: 'vbr',
      setRateControl: vi.fn(),
      ffmpegCodec: 'h264',
      ffmpegContainer: 'mp4',
      proresProfile: 'proxy',
      setProresProfile: vi.fn(),
      dnxhrProfile: 'dnxhr_lb',
      setDnxhrProfile: vi.fn(),
      ffmpegQuality: 20,
      setFfmpegQuality: vi.fn(),
      ffmpegBitrate: 1_000_000,
      ffmpegRateControl: 'crf',
      gifColors: 256,
      setGifColors: vi.fn(),
      gifDither: 'none',
      setGifDither: vi.fn(),
      gifLoop: 'forever',
      setGifLoop: vi.fn(),
      gifLoopCount: 3,
      setGifLoopCount: vi.fn(),
      gifPaletteMode: 'global',
      setGifPaletteMode: vi.fn(),
      gifOptimize: false,
      setGifOptimize: vi.fn(),
      gifTransparency: true,
      setGifTransparency: vi.fn(),
      gifAlphaThreshold: 128,
      setGifAlphaThreshold: vi.fn(),
      gifBayerScale: 3,
      setGifBayerScale: vi.fn(),
      isFFmpegLoading: false,
      isFFmpegReady: true,
      ffmpegLoadError: null,
      includeAlpha: false,
      setIncludeAlpha,
      stackedAlpha: false,
      setStackedAlpha: vi.fn(),
      includeAudio: false,
      setIncludeAudio,
      audioOnlyFormat: 'wav',
      setAudioOnlyFormat,
      audioSampleRate: 48000,
      setAudioSampleRate: vi.fn(),
      audioBitrate: 128000,
      setAudioBitrate: vi.fn(),
      normalizeAudio: false,
      setNormalizeAudio: vi.fn(),
      videoEnabled: true,
      setVideoEnabled,
      visualMode: isImageScenario ? 'image' : state.scenario === 'browser-gif' ? 'gif' : 'video',
      setVisualMode,
      imageFormat: 'bmp',
      setImageFormat: vi.fn(),
      imageExportMode: state.scenario === 'image-sequence' ? 'sequence' : 'frame',
      setImageExportMode: vi.fn(),
      imageQuality: 1,
      setImageQuality: vi.fn(),
      specialContainer: 'standard',
      setSpecialContainer: vi.fn(),
      isExporting: false,
      setIsExporting,
      progress: null,
      setProgress,
      ffmpegProgress: null,
      setFfmpegProgress,
      exportPhase: 'idle',
      setExportPhase,
      error: null,
      setError,
      exporter: null,
      setExporter,
      isSupported: true,
      isAudioSupported: true,
      audioCodec: 'aac',
      isFFmpegSupported: true,
      isFFmpegMultiThreaded: false,
      handleResolutionChange,
      loadFFmpeg: vi.fn(async () => undefined),
      handleFFmpegContainerChange,
      handleFFmpegCodecChange,
    };
  };

  return {
    MockAudioExportPipeline,
    MockExportFrameCaptureUnavailableError,
    MockExportRenderSessionImpl,
    MockFFmpegFrameRenderer,
    createExportState,
    createImageSequenceZip,
    checkBrowserGifExportSize,
    downloadBlob,
    encodeBrowserGif,
    endExport,
    exportStoreState,
    ffmpegBridge,
    frameRendererInstances,
    sessionInstances,
    setError,
    setExportPhase,
    setExportProgress,
    setFfmpegProgress,
    setIncludeAudio,
    setIsExporting,
    setProgress,
    setAudioOnlyFormat,
    setEncoder,
    setContainerFormat,
    handleFFmpegContainerChange,
    handleFFmpegCodecChange,
    setIncludeAlpha,
    setVideoEnabled,
    setVisualMode,
    setCustomWidth,
    setCustomHeight,
    setUseCustomResolution,
    handleResolutionChange,
    state,
    timelineState,
  };
});

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/export/fcpxmlExport', () => ({
  downloadFCPXML: vi.fn(),
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: vi.fn(() => false),
  },
}));

vi.mock('../../src/engine/export', () => ({
  FrameExporter: class {
    static getContainerFormats = vi.fn(() => [{ id: 'mp4', label: 'MP4' }]);
    static getVideoCodecs = vi.fn(() => [{ id: 'h264', label: 'H.264' }]);
    cancel = vi.fn();
    export = vi.fn(async () => new Blob(['webcodecs'], { type: 'video/mp4' }));
  },
  RESOLUTION_PRESETS: [{ label: 'Test', width: 32, height: 18 }],
  downloadBlob: mockFactory.downloadBlob,
}));

vi.mock('../../src/engine/audio', () => ({
  AudioExportPipeline: mockFactory.MockAudioExportPipeline,
  encodeAudioBufferToWavBlob: vi.fn(() => new Blob(['wav'], { type: 'audio/wav' })),
}));

vi.mock('../../src/engine/export/ImageSequenceExporter', () => ({
  blobToUint8Array: vi.fn(async () => new Uint8Array([1, 2, 3])),
  createImageSequenceZip: mockFactory.createImageSequenceZip,
  getImageSequenceFolderName: vi.fn((filename: string, format: string) => `${filename}-${format}`),
  getImageSequenceFrameName: vi.fn((filename: string, index: number, total: number, format: string) =>
    `${filename}-${String(index + 1).padStart(String(total).length, '0')}.${format}`
  ),
  isImageSequenceFolderExportSupported: vi.fn(() => false),
  isImageSequenceFolderSelectionAbort: vi.fn(() => false),
  pickImageSequenceOutputDirectory: vi.fn(async () => null),
  writeImageSequenceFrame: vi.fn(async () => undefined),
}));

vi.mock('../../src/engine/ffmpeg', () => ({
  getFFmpegBridge: vi.fn(() => mockFactory.ffmpegBridge),
  PRORES_PROFILES: [],
  DNXHR_PROFILES: [],
  HAP_FORMATS: [],
  CONTAINER_FORMATS: [
    { id: 'mp4', name: 'MP4' },
    { id: 'gif', name: 'GIF' },
  ],
  getCodecInfo: vi.fn(() => ({ name: 'H.264' })),
  getCodecsForContainer: vi.fn(() => [
    { id: 'h264', name: 'H.264', supportsAlpha: false },
    { id: 'utvideo', name: 'Ut Video', supportsAlpha: true },
  ]),
}));

vi.mock('../../src/components/export/CodecSelector', () => ({
  CodecSelector: () => null,
}));

vi.mock('../../src/engine/export/BrowserGifExporter', () => ({
  checkBrowserGifExportSize: mockFactory.checkBrowserGifExportSize,
  encodeBrowserGif: mockFactory.encodeBrowserGif,
}));

vi.mock('../../src/engine/export/ExportRenderSessionImpl', () => ({
  ExportFrameCaptureUnavailableError: mockFactory.MockExportFrameCaptureUnavailableError,
  ExportRenderSessionImpl: mockFactory.MockExportRenderSessionImpl,
}));

vi.mock('../../src/engine/gif/gifOptions', () => ({
  GIF_COLOR_PRESETS: [256],
  GIF_DITHER_OPTIONS: [{ id: 'none', label: 'None' }],
  GIF_PALETTE_MODES: [{ id: 'global', label: 'Global' }],
  estimateGifSize: vi.fn(() => ({ bytes: 1024, minBytes: 512, maxBytes: 2048 })),
  formatByteSize: vi.fn((bytes: number) => `${bytes} B`),
  getGifDitherLabel: vi.fn(() => 'None'),
  getGifPaletteModeLabel: vi.fn(() => 'Global'),
}));

vi.mock('../../src/components/export/exportHelpers', () => ({
  FFmpegFrameRenderer: mockFactory.MockFFmpegFrameRenderer,
}));

vi.mock('../../src/components/export/useExportState', () => ({
  useExportState: () => mockFactory.createExportState(),
}));

vi.mock('../../src/stores/timeline', () => {
  const useTimelineStore = Object.assign(
    vi.fn((selector?: (state: typeof mockFactory.timelineState) => unknown) =>
      selector ? selector(mockFactory.timelineState) : mockFactory.timelineState
    ),
    {
      getState: vi.fn(() => mockFactory.timelineState),
    },
  );
  return { useTimelineStore };
});

vi.mock('../../src/stores/mediaStore', () => {
  const composition = {
    id: 'comp-1',
    name: 'Test Composition',
    width: 32,
    height: 18,
    frameRate: 1,
  };
  const state = {
    activeCompositionId: composition.id,
    compositions: [composition],
    getActiveComposition: vi.fn(() => composition),
  };
  const useMediaStore = Object.assign(
    vi.fn((selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state)),
    {
      getState: vi.fn(() => state),
    },
  );
  return { useMediaStore };
});

vi.mock('../../src/stores/exportStore', () => {
  const useExportStore = Object.assign(
    vi.fn((selector?: (state: typeof mockFactory.exportStoreState) => unknown) =>
      selector ? selector(mockFactory.exportStoreState) : mockFactory.exportStoreState
    ),
    {
      getState: vi.fn(() => mockFactory.exportStoreState),
    },
  );
  return { useExportStore };
});

vi.mock('../../src/services/timeline/exportRuntimeReporting', () => ({
  canRetainExportRunJob: vi.fn(() => ({ admitted: true })),
  createExportRunId: vi.fn(() => 'export-run-a'),
  releaseExportRunResources: vi.fn(),
  reportExportRunJob: vi.fn(),
}));

class TestImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

function setScenario(scenario: ExportPanelScenario, throwRenderFrame: boolean): void {
  mockFactory.state.scenario = scenario;
  mockFactory.state.throwRenderFrame = throwRenderFrame;
}

async function clickExportAndWaitForSession(): Promise<InstanceType<typeof mockFactory.MockExportRenderSessionImpl>> {
  const { container } = render(<ExportPanel />);
  const button = container.querySelector<HTMLButtonElement>('.export-summary-cta');
  expect(button).not.toBeNull();

  fireEvent.click(button as HTMLButtonElement);

  await waitFor(() => {
    expect(mockFactory.sessionInstances).toHaveLength(1);
    expect(mockFactory.sessionInstances[0].dispose).toHaveBeenCalledTimes(1);
  });

  return mockFactory.sessionInstances[0];
}

beforeEach(() => {
  mockFactory.sessionInstances.length = 0;
  mockFactory.frameRendererInstances.length = 0;
  mockFactory.state.throwRenderFrame = false;
  mockFactory.state.exportMismatch = false;
  mockFactory.downloadBlob.mockClear();
  mockFactory.checkBrowserGifExportSize.mockClear();
  mockFactory.encodeBrowserGif.mockClear();
  mockFactory.createImageSequenceZip.mockClear();
  mockFactory.ffmpegBridge.encode.mockClear();
  mockFactory.ffmpegBridge.cancel.mockClear();
  mockFactory.exportStoreState.setSettings.mockClear();
  mockFactory.setError.mockClear();
  mockFactory.setIsExporting.mockClear();
  mockFactory.setProgress.mockClear();
  mockFactory.setFfmpegProgress.mockClear();
  mockFactory.setIncludeAudio.mockClear();
  mockFactory.setExportPhase.mockClear();
  mockFactory.setExportProgress.mockClear();
  mockFactory.setAudioOnlyFormat.mockClear();
  mockFactory.setEncoder.mockClear();
  mockFactory.setContainerFormat.mockClear();
  mockFactory.handleFFmpegContainerChange.mockClear();
  mockFactory.handleFFmpegCodecChange.mockClear();
  mockFactory.setIncludeAlpha.mockClear();
  mockFactory.setVideoEnabled.mockClear();
  mockFactory.setVisualMode.mockClear();
  mockFactory.setCustomWidth.mockClear();
  mockFactory.setCustomHeight.mockClear();
  mockFactory.setUseCustomResolution.mockClear();
  mockFactory.handleResolutionChange.mockClear();
  mockFactory.endExport.mockClear();

  if (typeof globalThis.ImageData === 'undefined') {
    (globalThis as typeof globalThis & { ImageData: typeof ImageData }).ImageData =
      TestImageData as unknown as typeof ImageData;
  }
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

describe('ExportPanel render-session adoption', () => {
  it('keeps export ownership through cancel cleanup and ignores same-tick duplicate starts', async () => {
    setScenario('browser-gif', false);
    let settle!: (value: null) => void;
    controlledVideoRunner.mockReset().mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }))
      .mockResolvedValue(null);
    const { result } = renderHook(() => useExportRunController({
      exportState: mockFactory.createExportState() as Parameters<typeof useExportRunController>[0]['exportState'],
      playheadPosition: 0, startExport: vi.fn(), setExportProgress: vi.fn(), endExport: mockFactory.endExport,
      getActiveComposition: () => undefined, selectedImageFormat: {} as never,
      isXmlMode: false, isImageMode: false, isImageSequenceMode: false, isGifMode: false,
      isWebCodecsEncoder: true, storyboardExportMode: 'normal-export',
    }));
    act(() => { result.current.handlePrimaryExport(); result.current.handlePrimaryExport(); });
    await waitFor(() => expect(controlledVideoRunner).toHaveBeenCalledTimes(1));
    act(() => { result.current.handleCancel(); result.current.handlePrimaryExport(); });
    expect(mockFactory.endExport).not.toHaveBeenCalled();
    expect(controlledVideoRunner).toHaveBeenCalledTimes(1);
    await act(async () => { settle(null); });
    expect(mockFactory.endExport).toHaveBeenCalledTimes(1);
    act(() => result.current.handlePrimaryExport());
    await waitFor(() => expect(controlledVideoRunner).toHaveBeenCalledTimes(2));
  });

  it('leaves GIF mode when selecting MP3 audio-only output', () => {
    setScenario('browser-gif', false);

    const { container, getByRole } = render(<ExportPanel />);
    fireEvent.click(getByRole('combobox', { name: 'Export container' }));
    fireEvent.click(container.querySelector<HTMLElement>('[data-value="audio:mp3"]')!);

    expect(mockFactory.setVisualMode).toHaveBeenCalledWith('video');
    expect(mockFactory.setVideoEnabled).toHaveBeenCalledWith(false);
    expect(mockFactory.setIncludeAudio).toHaveBeenCalledWith(true);
    expect(mockFactory.setAudioOnlyFormat).toHaveBeenCalledWith('mp3');
  });

  it('always lists video containers and routes each family to its encoder', () => {
    setScenario('ffmpeg-video', false);

    const { container, getByRole } = render(<ExportPanel />);
    const containerSelect = getByRole('combobox', { name: 'Export container' });
    fireEvent.click(containerSelect);
    const values = Array.from(
      container.querySelectorAll<HTMLElement>('.inspector-select-option'),
      option => option.dataset.value,
    );

    expect(values).toEqual(expect.arrayContaining([
      'video:mp4', 'video:webm', 'video:mov', 'video:mkv', 'video:avi', 'video:mxf', 'video:gif',
    ]));

    fireEvent.click(container.querySelector<HTMLElement>('[data-value="video:webm"]')!);
    expect(mockFactory.setEncoder).toHaveBeenCalledWith('webcodecs');
    expect(mockFactory.setContainerFormat).toHaveBeenCalledWith('webm');

    fireEvent.click(containerSelect);
    fireEvent.click(container.querySelector<HTMLElement>('[data-value="video:mov"]')!);
    expect(mockFactory.setEncoder).toHaveBeenCalledWith('ffmpeg');
    expect(mockFactory.handleFFmpegContainerChange).toHaveBeenCalledWith('mov');
  });

  it('enables native alpha by default when selecting an alpha codec', () => {
    setScenario('ffmpeg-video', false);

    const { container, getByRole } = render(<ExportPanel />);
    fireEvent.click(getByRole('combobox', { name: 'Video codec' }));
    fireEvent.click(container.querySelector<HTMLElement>('[data-value="utvideo"]')!);

    expect(mockFactory.handleFFmpegCodecChange).toHaveBeenCalledWith('utvideo');
    expect(mockFactory.setIncludeAlpha).toHaveBeenCalledWith(true);
  });

  it('toggles a video preset to portrait without making it custom', () => {
    setScenario('ffmpeg-video', false);
    const { getByRole } = render(<ExportPanel />);

    fireEvent.click(getByRole('checkbox', { name: 'Match composition resolution' }));
    fireEvent.click(getByRole('button', { name: 'Switch to 9:16 portrait' }));

    expect(mockFactory.handleResolutionChange).toHaveBeenCalledWith('18x32');
    expect(mockFactory.setUseCustomResolution).toHaveBeenCalledWith(false);
    expect(mockFactory.setCustomWidth).not.toHaveBeenCalled();
    expect(mockFactory.setCustomHeight).not.toHaveBeenCalled();
  });

  it('matches composition settings globally or per output field', () => {
    setScenario('ffmpeg-video', false);
    const { getByRole } = render(<ExportPanel />);
    const globalMatch = getByRole('checkbox', { name: 'Same as composition' });
    const resolutionMatch = getByRole('checkbox', { name: 'Match composition resolution' });
    const frameRateMatch = getByRole('checkbox', { name: 'Match composition frame rate' });
    const resolution = getByRole('combobox', { name: 'Video resolution' });
    const frameRate = getByRole('combobox', { name: 'Frame rate' });

    expect(globalMatch).toBeChecked();
    expect(resolution).toBeDisabled();
    expect(frameRate).toBeDisabled();

    fireEvent.click(resolutionMatch);
    expect(globalMatch).not.toBeChecked();
    expect(resolution).toBeEnabled();
    expect(frameRate).toBeDisabled();

    fireEvent.click(globalMatch);
    expect(resolutionMatch).toBeChecked();
    expect(frameRateMatch).toBeChecked();
    expect(resolution).toBeDisabled();
    expect(frameRate).toBeDisabled();

    fireEvent.click(globalMatch);
    expect(resolutionMatch).not.toBeChecked();
    expect(frameRateMatch).not.toBeChecked();
    expect(resolution).toBeEnabled();
    expect(frameRate).toBeEnabled();
  });

  it('shows presets first, removes summary shortcuts, and keeps size in the export button', () => {
    setScenario('ffmpeg-video', false);
    const { container, getByRole } = render(<ExportPanel />);
    const preset = getByRole('combobox', { name: 'Export preset' });
    const outputSection = getByRole('button', { name: 'Output' });

    expect(preset.compareDocumentPosition(outputSection) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(container.querySelector('.export-quick-summary-row')).toBeNull();
    expect(container.querySelector('.export-summary-cta-size')?.textContent).toMatch(/^~\d+ MB$/);
  });

  it.each<ExportPanelScenario>([
    'browser-gif',
    'ffmpeg-video',
    'still-image',
    'image-sequence',
  ])('%s begins and disposes one render session on success', async (scenario) => {
    setScenario(scenario, false);

    const session = await clickExportAndWaitForSession();

    expect(session.begin).toHaveBeenCalledTimes(1);
    expect(session.renderFrame).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it.each<ExportPanelScenario>([
    'browser-gif',
    'ffmpeg-video',
    'still-image',
    'image-sequence',
  ])('%s disposes its render session when renderFrame throws', async (scenario) => {
    setScenario(scenario, true);

    const session = await clickExportAndWaitForSession();

    expect(session.begin).toHaveBeenCalledTimes(1);
    expect(session.renderFrame).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(mockFactory.setError).toHaveBeenCalled();
  });
});
