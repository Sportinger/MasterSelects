import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'

const jsdomStorage = (globalThis as typeof globalThis & { jsdom?: { window: Window } }).jsdom?.window.localStorage

Object.defineProperty(globalThis, 'localStorage', {
  value: jsdomStorage,
  writable: true,
  configurable: true,
})

// Mock modules that have side effects requiring browser APIs (WebGPU, HMR, etc.)
// These must be vi.mock() calls at the top level so they're hoisted before imports

vi.mock('../src/engine/WebGPUEngine', () => ({
  engine: {
    initialize: vi.fn().mockResolvedValue(true),
    start: vi.fn(),
    stop: vi.fn(),
    render: vi.fn(),
    renderCachedFrame: vi.fn().mockReturnValue(false),
    setExporting: vi.fn(),
    initExportCanvas: vi.fn().mockReturnValue(true),
    isDeviceValid: vi.fn().mockReturnValue(true),
    setRenderTimeOverride: vi.fn(),
    ensureExportLayersReady: vi.fn().mockResolvedValue(undefined),
    createVideoFrameFromExport: vi.fn().mockResolvedValue(null),
    cleanupExportCanvas: vi.fn(),
    hasMaskTexture: vi.fn().mockReturnValue(false),
    ensureGaussianSplatSceneLoaded: vi.fn().mockResolvedValue(true),
    ensureSceneRendererInitialized: vi.fn().mockResolvedValue(true),
    preloadSceneModelAsset: vi.fn().mockResolvedValue(true),
    setGeneratingRamPreview: vi.fn(),
    setTimelineVisualDemand: vi.fn(),
    setVisualTargetFps: vi.fn(),
    setContinuousRender: vi.fn(),
    setResolution: vi.fn(),
    getOutputDimensions: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    readPixels: vi.fn().mockResolvedValue(null),
    getDevice: vi.fn().mockReturnValue(null),
    getLastRenderedTexture: vi.fn().mockReturnValue(null),
    updateMaskTexture: vi.fn(),
    removeMaskTexture: vi.fn(),
    setPreviewCanvas: vi.fn(),
    registerTargetCanvas: vi.fn().mockReturnValue({}),
    unregisterTargetCanvas: vi.fn(),
    clearCompositeCache: vi.fn(),
    clearScrubbingCache: vi.fn(),
    cacheCompositeFrame: vi.fn(),
    cacheActiveCompOutput: vi.fn(),
    requestRender: vi.fn(),
    requestNewFrameRender: vi.fn(),
    setIsPlaying: vi.fn(),
    setIsScrubbing: vi.fn(),
    getStats: vi.fn().mockReturnValue({
      fps: 0,
      frameTime: 0,
      gpuMemory: 0,
      timing: { rafGap: 0, importTexture: 0, renderPass: 0, submit: 0, total: 0 },
      drops: { count: 0, lastSecond: 0, reason: 'none' },
      layerCount: 0,
      targetFps: 60,
      decoder: 'none',
      audio: { playing: 0, drift: 0, status: 'silent' },
      isIdle: false,
    }),
    getRenderLoop: vi.fn().mockReturnValue({ getIsRunning: vi.fn().mockReturnValue(true) }),
    getLayerCollector: vi.fn().mockReturnValue(null),
    getScrubbingCacheStats: vi.fn().mockReturnValue({}),
    getCompositeCacheStats: vi.fn().mockReturnValue({}),
    getDebugInfrastructureState: vi.fn().mockReturnValue({}),
    getRenderDispatcherDebugSnapshot: vi.fn().mockReturnValue(null),
    getGPUInfo: vi.fn().mockReturnValue(null),
    createOutputWindow: vi.fn(),
    closeOutputWindow: vi.fn(),
    restoreOutputWindow: vi.fn(),
    removeOutputTarget: vi.fn(),
    getIsExporting: vi.fn().mockReturnValue(false),
    renderToPreviewCanvas: vi.fn(),
    copyNestedCompTextureToPreview: vi.fn().mockReturnValue(false),
    ensureVideoFrameCached: vi.fn(),
    preCacheVideoFrame: vi.fn().mockResolvedValue(true),
    cacheFrameAtTime: vi.fn(),
    markVideoFramePresented: vi.fn(),
    captureVideoFrameAtTime: vi.fn().mockReturnValue(false),
    getLastPresentedVideoTime: vi.fn().mockReturnValue(undefined),
    markVideoGpuReady: vi.fn(),
    cleanupVideo: vi.fn(),
    clearVideoCache: vi.fn(),
    clearCaches: vi.fn(),
    clearFrame: vi.fn(),
    getScrubbingCachedRanges: vi.fn().mockReturnValue([]),
    getTextureManager: vi.fn().mockReturnValue({
      updateCanvasTexture: vi.fn().mockReturnValue(true),
    }),
  },
  WebGPUEngine: vi.fn(),
}))

vi.mock('../src/engine/WebCodecsPlayer', () => ({
  WebCodecsPlayer: vi.fn(),
}))

// Mock services needed by clipSlice and its sub-modules
vi.mock('../src/services/textRenderer', () => ({
  textRenderer: {
    createCanvas: vi.fn().mockReturnValue(document.createElement('canvas')),
    render: vi.fn(),
  },
}))

vi.mock('../src/services/googleFontsService', () => ({
  googleFontsService: {
    loadFont: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('../src/services/thumbnailRenderer', () => ({
  thumbnailRenderer: {
    generateClipThumbnails: vi.fn().mockResolvedValue([]),
    generateCompositionThumbnails: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../src/services/nativeHelper', () => ({
  NativeDecoder: vi.fn(),
  NativeHelperClient: {
    isConnected: vi.fn(() => false),
    getDownloadedFile: vi.fn(async () => null),
    listDir: vi.fn(async () => []),
  },
}))

vi.mock('../src/services/nativeHelper/NativeHelperClient', () => ({
  NativeHelperClient: vi.fn(),
}))

vi.mock('../src/services/layerBuilder', () => ({
  layerBuilder: {
    invalidateCache: vi.fn(),
    buildLayers: vi.fn().mockReturnValue([]),
    buildLayersFromStore: vi.fn().mockReturnValue([]),
    getVideoSyncManager: vi.fn().mockReturnValue({
      reset: vi.fn(),
    }),
  },
}))

vi.mock('../src/services/proxyFrameCache', () => ({
  proxyFrameCache: {
    getCachedRanges: vi.fn().mockReturnValue([]),
    cancelPreload: vi.fn(),
    warmScrubAudioBuffer: vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('../src/services/audioAnalyzer', () => ({
  audioAnalyzer: {
    generateFingerprint: vi.fn(),
  },
}))

vi.mock('../src/services/fileSystemService', () => ({
  fileSystemService: {
    getFileHandle: vi.fn(),
  },
}))

// Mock store modules that trigger heavy import chains
vi.mock('../src/stores/mediaStore', () => ({
  useMediaStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({
      files: [],
      compositions: [],
      folders: [],
      selectedIds: [],
      expandedFolderIds: [],
      textItems: [],
      solidItems: [],
      activeCompositionId: null,
      outputResolution: { width: 1920, height: 1080 },
      sourceMonitorInPoint: null,
      sourceMonitorOutPoint: null,
      addMediaFile: vi.fn(),
      updateComposition: vi.fn(),
      setSourceMonitorInPoint: vi.fn(),
      setSourceMonitorOutPoint: vi.fn(),
      clearSourceMonitorInOut: vi.fn(),
      getActiveComposition: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      getOrCreateTextFolder: vi.fn().mockReturnValue('text-folder-1'),
      createTextItem: vi.fn(),
      getOrCreateSolidFolder: vi.fn().mockReturnValue('solid-folder-1'),
      createSolidItem: vi.fn(),
      getOrCreateCameraFolder: vi.fn().mockReturnValue('camera-folder-1'),
      createCameraItem: vi.fn().mockReturnValue('camera-item-1'),
    })),
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
}))

vi.mock('../src/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({
      outputResolution: { width: 1920, height: 1080 },
    })),
    setState: vi.fn(),
    subscribe: vi.fn(),
  }),
}))

// Mock window.matchMedia (jsdom does not implement it). Components such as
// useTheme and DockContainer query media features
// in passive effects, which throws "matchMedia is not a function" otherwise.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList),
  })
}

// Mock WebGPU API
Object.defineProperty(navigator, 'gpu', {
  value: {
    requestAdapter: vi.fn().mockResolvedValue({
      requestDevice: vi.fn().mockResolvedValue({
        createBuffer: vi.fn(),
        createTexture: vi.fn(),
        createShaderModule: vi.fn(),
        createBindGroupLayout: vi.fn(),
        createPipelineLayout: vi.fn(),
        createRenderPipeline: vi.fn(),
        createComputePipeline: vi.fn(),
        createBindGroup: vi.fn(),
        createCommandEncoder: vi.fn(),
        queue: {
          submit: vi.fn(),
          writeBuffer: vi.fn(),
          copyExternalImageToTexture: vi.fn(),
        },
        destroy: vi.fn(),
      }),
      features: new Set(),
      limits: {},
    }),
    getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
  },
  writable: true,
  configurable: true,
})

// Mock WebCodecs
class MockVideoDecoder {
  static isConfigSupported = vi.fn().mockResolvedValue({ supported: true })
  configure = vi.fn()
  decode = vi.fn()
  flush = vi.fn().mockResolvedValue(undefined)
  close = vi.fn()
  reset = vi.fn()
  state = 'unconfigured' as const
}

class MockVideoFrame {
  readonly timestamp: number
  readonly codedWidth: number
  readonly codedHeight: number
  constructor(data: unknown, init?: { timestamp?: number; codedWidth?: number; codedHeight?: number }) {
    this.timestamp = init?.timestamp ?? 0
    this.codedWidth = init?.codedWidth ?? 1920
    this.codedHeight = init?.codedHeight ?? 1080
  }
  close = vi.fn()
  clone = vi.fn().mockReturnThis()
}

if (typeof globalThis.VideoDecoder === 'undefined') {
  (globalThis as Record<string, unknown>).VideoDecoder = MockVideoDecoder
}
if (typeof globalThis.VideoFrame === 'undefined') {
  (globalThis as Record<string, unknown>).VideoFrame = MockVideoFrame
}

// Mock AudioContext
class MockAudioContext {
  sampleRate = 44100
  state = 'running' as const
  destination = { maxChannelCount: 2 }
  createGain = vi.fn().mockReturnValue({
    gain: { value: 1, setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  })
  createBufferSource = vi.fn().mockReturnValue({
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })
  createAnalyser = vi.fn().mockReturnValue({
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteFrequencyData: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })
  decodeAudioData = vi.fn().mockResolvedValue({
    numberOfChannels: 2,
    sampleRate: 44100,
    length: 44100,
    duration: 1,
    getChannelData: vi.fn().mockReturnValue(new Float32Array(44100)),
  })
  close = vi.fn().mockResolvedValue(undefined)
  resume = vi.fn().mockResolvedValue(undefined)
}

if (typeof globalThis.AudioContext === 'undefined') {
  (globalThis as Record<string, unknown>).AudioContext = MockAudioContext
}

// Mock HTMLMediaElement play/pause
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
HTMLMediaElement.prototype.pause = vi.fn()
HTMLMediaElement.prototype.load = vi.fn()

// Clean up mocks after each test
afterEach(() => {
  vi.clearAllMocks()
})
