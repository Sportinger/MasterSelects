import { beforeEach, describe, expect, it, vi } from 'vitest';

const mediaRuntimeMocks = vi.hoisted(() => ({
  renderHostMode: 'main',
  createWorkerWebCodecsFrameProvider: vi.fn(),
  createTurboResFrameProvider: vi.fn(),
  requestRender: vi.fn(),
  requestNewFrameRender: vi.fn(),
}));

vi.mock('../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    getTelemetry: () => ({
      mode: mediaRuntimeMocks.renderHostMode,
      presentationStrategy: 'main-webgpu',
      lifecycleOwner: 'renderHostPort',
      statsOwner: 'renderHostPort',
      watchdogOwner: 'renderHostPort',
      selection: {
        selectedId: 'main-fallback',
        selectedRole: 'fallback',
        workerPrimaryRequested: false,
        workerPrimaryRegistered: false,
        workerPrimaryAvailable: false,
        blockers: [],
        reason: 'test render host',
      },
    }),
    requestRender: mediaRuntimeMocks.requestRender,
    requestNewFrameRender: mediaRuntimeMocks.requestNewFrameRender,
  },
}));

vi.mock('../../src/services/mediaRuntime/workerWebCodecsFrameProvider', () => {
  class WorkerWebCodecsFrameProvider {
    currentTime = 0;
    isPlaying = false;
    advanceToTime = vi.fn((time: number) => {
      this.currentTime = time;
    });
    seek = vi.fn((time: number) => {
      this.currentTime = time;
    });
    destroy = vi.fn();
    isFullMode = vi.fn(() => true);
    isSimpleMode = vi.fn(() => false);
    getCurrentFrame = vi.fn(() => null);
  }

  return {
    createWorkerWebCodecsFrameProvider: mediaRuntimeMocks.createWorkerWebCodecsFrameProvider,
    WorkerWebCodecsFrameProvider,
  };
});

vi.mock('../../src/services/mediaRuntime/prores/TurboResFrameProvider', () => ({
  createTurboResFrameProvider: mediaRuntimeMocks.createTurboResFrameProvider,
}));

import { useMediaStore } from '../../src/stores/mediaStore';
import {
  bindSourceRuntimeToClip,
  releaseClipTreeRuntimeBindings,
} from '../../src/services/mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import {
  canUseSharedPreviewRuntimeSession,
  ensureRuntimeFrameProvider,
  getPolicyRuntimeSource,
  getRuntimeFrameProvider,
  getPreviewRuntimeSource,
  getScrubRuntimeSource,
  releaseRuntimePlaybackSession,
  readRuntimeFrameForSource,
  setRuntimeFrameProvider,
  updateRuntimePlaybackTime,
} from '../../src/services/mediaRuntime/runtimePlayback';
import { WebCodecsPlayer } from '../../src/engine/WebCodecsPlayer';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { flags } from '../../src/engine/featureFlags';
import type { TimelineClip } from '../../src/types';
import type { RuntimeFrameProvider } from '../../src/services/mediaRuntime/types';
import {
  hasLayerBuilderRenderableVideoSource,
  resolveLayerBuilderVideoSource,
} from '../../src/services/layerBuilder/layerBuilderVideoSources';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import {
  createWorkerWebCodecsFrameProvider,
  WorkerWebCodecsFrameProvider,
} from '../../src/services/mediaRuntime/workerWebCodecsFrameProvider';

type WebCodecsPlayerSlot = NonNullable<TimelineClip['source']>['webCodecsPlayer'];
const asWebCodecsPlayer = (player: unknown): WebCodecsPlayerSlot => player as WebCodecsPlayerSlot;
const asRuntimeProvider = (provider: unknown): RuntimeFrameProvider => provider as RuntimeFrameProvider;

function makeTransform() {
  return {
    opacity: 1,
    blendMode: 'normal' as const,
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function makeClip(
  id: string,
  file: File,
  source: TimelineClip['source'],
  nestedClips?: TimelineClip[]
): TimelineClip {
  return {
    id,
    trackId: 'track-1',
    name: id,
    file,
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source,
    transform: makeTransform(),
    effects: [],
    isLoading: false,
    ...(nestedClips ? { nestedClips } : {}),
  };
}

function setMediaFiles(files: unknown[]): void {
  const mediaStoreMock = useMediaStore as unknown as {
    getState: ReturnType<typeof vi.fn>;
  };
  mediaStoreMock.getState.mockReturnValue({
    files,
    compositions: [],
    folders: [],
    selectedIds: [],
    expandedFolderIds: [],
    textItems: [],
    solidItems: [],
    activeCompositionId: null,
    outputResolution: { width: 1920, height: 1080 },
    addMediaFile: vi.fn(),
    updateComposition: vi.fn(),
    getActiveComposition: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    getOrCreateTextFolder: vi.fn().mockReturnValue('text-folder-1'),
    createTextItem: vi.fn(),
    getOrCreateSolidFolder: vi.fn().mockReturnValue('solid-folder-1'),
    createSolidItem: vi.fn(),
  });
}

function restoreGlobalProperty(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
}

function enableWorkerWebCodecsTestCapability(): () => void {
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const createImageBitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: vi.fn(),
  });
  mediaRuntimeMocks.renderHostMode = 'worker-only';

  return () => {
    mediaRuntimeMocks.renderHostMode = 'main';
    restoreGlobalProperty('createImageBitmap', createImageBitmapDescriptor);
    restoreGlobalProperty('Worker', workerDescriptor);
  };
}

function makeCloneableVideoFrame(
  timestamp: number,
  cloneCloseSpies?: Array<ReturnType<typeof vi.fn>>
): VideoFrame {
  return {
    timestamp,
    displayWidth: 1920,
    displayHeight: 1080,
    codedWidth: 1920,
    codedHeight: 1080,
    close: vi.fn(),
    clone: vi.fn(() => {
      const closeSpy = vi.fn();
      cloneCloseSpies?.push(closeSpy);
      return {
        timestamp,
        displayWidth: 1920,
        displayHeight: 1080,
        codedWidth: 1920,
        codedHeight: 1080,
        close: closeSpy,
      } as VideoFrame;
    }),
  } as VideoFrame;
}

describe('media runtime bindings', () => {
  beforeEach(() => {
    mediaRuntimeRegistry.clear();
    timelineRuntimeCoordinator.clearResources();
    setMediaFiles([]);
    vi.mocked(WebCodecsPlayer).mockReset();
    mediaRuntimeMocks.renderHostMode = 'main';
    mediaRuntimeMocks.createWorkerWebCodecsFrameProvider.mockReset();
    mediaRuntimeMocks.createTurboResFrameProvider.mockReset();
    mediaRuntimeMocks.requestRender.mockReset();
    mediaRuntimeMocks.requestNewFrameRender.mockReset();
    flags.turboResProRes = false;
  });

  it('uses mediaFileId as the canonical runtime identity', () => {
    const file = new File(['video'], 'demo.mp4', { type: 'video/mp4', lastModified: 1 });
    setMediaFiles([
      {
        id: 'media-1',
        file,
        name: 'demo.mp4',
        duration: 12,
        width: 1920,
        height: 1080,
        fps: 24,
      },
    ]);

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-1',
      source: {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-1',
      },
      file,
      mediaFileId: 'media-1',
    });

    expect(source?.runtimeSourceId).toBe('media:media-1');
    expect(source?.runtimeSessionKey).toBe('interactive:clip-1');
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(1);
    expect(mediaRuntimeRegistry.getRuntime('media:media-1')?.ownerCount()).toBe(1);
    expect(mediaRuntimeRegistry.getRuntime('media:media-1')?.metadata.duration).toBe(12);
  });

  it('reuses a single runtime for multiple clips referencing the same media file', () => {
    const file = new File(['video'], 'shared.mp4', { type: 'video/mp4', lastModified: 2 });
    setMediaFiles([
      {
        id: 'media-shared',
        file,
        name: 'shared.mp4',
        duration: 20,
      },
    ]);

    bindSourceRuntimeToClip({
      clipId: 'clip-a',
      source: {
        type: 'video',
        naturalDuration: 20,
        mediaFileId: 'media-shared',
      },
      file,
      mediaFileId: 'media-shared',
    });

    bindSourceRuntimeToClip({
      clipId: 'clip-b',
      source: {
        type: 'video',
        naturalDuration: 20,
        mediaFileId: 'media-shared',
      },
      file,
      mediaFileId: 'media-shared',
    });

    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(1);
    expect(mediaRuntimeRegistry.getRuntime('media:media-shared')?.ownerCount()).toBe(2);
  });

  it('releases runtimes recursively for nested clip trees', () => {
    const file = new File(['video'], 'nested.mp4', { type: 'video/mp4', lastModified: 3 });
    setMediaFiles([
      {
        id: 'media-nested',
        file,
        name: 'nested.mp4',
        duration: 8,
      },
    ]);

    const parentSource = bindSourceRuntimeToClip({
      clipId: 'clip-parent',
      source: {
        type: 'video',
        naturalDuration: 8,
        mediaFileId: 'media-nested',
      },
      file,
      mediaFileId: 'media-nested',
    });
    const nestedSource = bindSourceRuntimeToClip({
      clipId: 'clip-child',
      source: {
        type: 'video',
        naturalDuration: 8,
        mediaFileId: 'media-nested',
      },
      file,
      mediaFileId: 'media-nested',
    });

    const nestedClip = makeClip('clip-child', file, nestedSource);
    const parentClip = makeClip('clip-parent', file, parentSource, [nestedClip]);

    expect(mediaRuntimeRegistry.getRuntime('media:media-nested')?.ownerCount()).toBe(2);

    releaseClipTreeRuntimeBindings(parentClip);

    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
  });

  it('skips runtime creation for placeholder files without a stable source identity', () => {
    const placeholderFile = new File([], 'placeholder.wav', { type: 'audio/wav', lastModified: 4 });

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-placeholder',
      source: {
        type: 'audio',
        naturalDuration: 3,
      },
      file: placeholderFile,
    });

    expect(source?.runtimeSourceId).toBeUndefined();
    expect(source?.runtimeSessionKey).toBeUndefined();
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
  });

  it('attaches a clip WebCodecs player to the runtime session on demand', () => {
    const file = new File(['video'], 'session.mp4', { type: 'video/mp4', lastModified: 5 });
    setMediaFiles([
      {
        id: 'media-session',
        file,
        name: 'session.mp4',
        duration: 6,
      },
    ]);

    const frame = {
      timestamp: 2_000_000,
      displayWidth: 1280,
      displayHeight: 720,
    } as VideoFrame;
    const player = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => frame,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-session',
      source: {
        type: 'video',
        naturalDuration: 6,
        mediaFileId: 'media-session',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-session',
    });

    const provider = getRuntimeFrameProvider(source);

    expect(provider).toBe(player);
    expect(
      mediaRuntimeRegistry.getSession('media:media-session', 'interactive:clip-session')?.frameProvider
    ).toBe(player);
  });

  it('reads the current frame through the runtime-backed preview binding', () => {
    const file = new File(['video'], 'frame.mp4', { type: 'video/mp4', lastModified: 6 });
    setMediaFiles([
      {
        id: 'media-frame',
        file,
        name: 'frame.mp4',
        duration: 9,
      },
    ]);

    const frame = {
      timestamp: 3_500_000,
      displayWidth: 1920,
      displayHeight: 1080,
    } as VideoFrame;
    const player = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => frame,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-frame',
      source: {
        type: 'video',
        naturalDuration: 9,
        mediaFileId: 'media-frame',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-frame',
    });

    updateRuntimePlaybackTime(source, 3.5);
    const runtimeFrame = readRuntimeFrameForSource(source);

    expect(runtimeFrame?.binding.session.currentTime).toBe(3.5);
    expect(runtimeFrame?.frameHandle?.frame).toBe(frame);
    expect(runtimeFrame?.frameHandle?.timestamp).toBe(3_500_000);
  });

  it('reuses one shared preview session for sequential same-source full WebCodecs clips on the same track', () => {
    const file = new File(['video'], 'sequence.mp4', { type: 'video/mp4', lastModified: 7 });
    setMediaFiles([
      {
        id: 'media-sequence',
        file,
        name: 'sequence.mp4',
        duration: 10,
      },
    ]);

    const playerA = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };
    const playerB = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const sourceA = bindSourceRuntimeToClip({
      clipId: 'clip-seq-a',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-sequence',
        webCodecsPlayer: asWebCodecsPlayer(playerA),
      },
      file,
      mediaFileId: 'media-sequence',
    });
    const sourceB = bindSourceRuntimeToClip({
      clipId: 'clip-seq-b',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-sequence',
        webCodecsPlayer: asWebCodecsPlayer(playerB),
      },
      file,
      mediaFileId: 'media-sequence',
    });

    expect(
      canUseSharedPreviewRuntimeSession(
        { trackId: 'track-1' },
        [{ trackId: 'track-1' }]
      )
    ).toBe(true);

    const previewSourceA = getPreviewRuntimeSource(sourceA, 'track-1', true);
    const previewSourceB = getPreviewRuntimeSource(sourceB, 'track-1', true);

    expect(previewSourceA?.runtimeSessionKey).toBe(
      'interactive-track:track-1:media:media-sequence'
    );
    expect(previewSourceB?.runtimeSessionKey).toBe(
      'interactive-track:track-1:media:media-sequence'
    );

    const providerA = getRuntimeFrameProvider(previewSourceA);
    const providerB = getRuntimeFrameProvider(previewSourceB);

    expect(providerA).toBe(playerA);
    expect(providerB).toBe(playerA);
    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-sequence',
        'interactive-track:track-1:media:media-sequence'
      )?.frameProvider
    ).toBe(playerA);
  });

  it('scopes shared preview sessions by nested composition context', () => {
    const file = new File(['video'], 'nested-scope.mp4', { type: 'video/mp4', lastModified: 7_1 });
    setMediaFiles([
      {
        id: 'media-nested-scope',
        file,
        name: 'nested-scope.mp4',
        duration: 10,
      },
    ]);

    const playerA = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };
    const playerB = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const sourceA = bindSourceRuntimeToClip({
      clipId: 'clip-nested-scope-a',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-nested-scope',
        webCodecsPlayer: asWebCodecsPlayer(playerA),
      },
      file,
      mediaFileId: 'media-nested-scope',
    });
    const sourceB = bindSourceRuntimeToClip({
      clipId: 'clip-nested-scope-b',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-nested-scope',
        webCodecsPlayer: asWebCodecsPlayer(playerB),
      },
      file,
      mediaFileId: 'media-nested-scope',
    });

    const previewSourceA = getPreviewRuntimeSource(
      sourceA,
      'track-1',
      true,
      'composition:comp-a/nested:n1'
    );
    const previewSourceB = getPreviewRuntimeSource(
      sourceB,
      'track-1',
      true,
      'composition:comp-b/nested:n1'
    );

    expect(previewSourceA?.runtimeSessionKey).toBe(
      'interactive-track:composition:comp-a/nested:n1:track-1:media:media-nested-scope'
    );
    expect(previewSourceB?.runtimeSessionKey).toBe(
      'interactive-track:composition:comp-b/nested:n1:track-1:media:media-nested-scope'
    );
    expect(getRuntimeFrameProvider(previewSourceA)).toBe(playerA);
    expect(getRuntimeFrameProvider(previewSourceB)).toBe(playerB);
  });

  it('creates distinct policy-scoped runtime sessions for export and RAM preview', () => {
    const file = new File(['video'], 'policy-scope.mp4', { type: 'video/mp4', lastModified: 72 });
    setMediaFiles([
      {
        id: 'media-policy-scope',
        file,
        name: 'policy-scope.mp4',
        duration: 8,
      },
    ]);

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-policy-scope',
      source: {
        type: 'video',
        naturalDuration: 8,
        mediaFileId: 'media-policy-scope',
      },
      file,
      mediaFileId: 'media-policy-scope',
    });

    const exportSource = getPolicyRuntimeSource(
      source,
      'export',
      'clip-policy-scope'
    );
    const ramPreviewSource = getPolicyRuntimeSource(
      source,
      'ram-preview',
      'clip-policy-scope',
      'nested:comp-1'
    );

    expect(exportSource?.runtimeSessionKey).toBe(
      'export:clip-policy-scope:media:media-policy-scope'
    );
    expect(ramPreviewSource?.runtimeSessionKey).toBe(
      'ram-preview:nested:comp-1:clip-policy-scope:media:media-policy-scope'
    );
  });

  it('attaches and releases providers on explicit export runtime sessions', () => {
    const file = new File(['video'], 'export-session.mp4', { type: 'video/mp4', lastModified: 73 });
    setMediaFiles([
      {
        id: 'media-export-session',
        file,
        name: 'export-session.mp4',
        duration: 8,
      },
    ]);

    const player = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-export-session',
      source: {
        type: 'video',
        naturalDuration: 8,
        mediaFileId: 'media-export-session',
      },
      file,
      mediaFileId: 'media-export-session',
    });
    const exportSource = getPolicyRuntimeSource(
      source,
      'export',
      'clip-export-session'
    );

    setRuntimeFrameProvider(exportSource, asRuntimeProvider(player), 'export');

    expect(getRuntimeFrameProvider(exportSource, 'export')).toBe(player);

    releaseRuntimePlaybackSession(exportSource);

    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-export-session',
        'export:clip-export-session:media:media-export-session'
      )
    ).toBeNull();
  });

  it('keeps preview and export runtime sessions isolated for the same source', () => {
    const file = new File(['video'], 'preview-export.mp4', { type: 'video/mp4', lastModified: 74 });
    setMediaFiles([
      {
        id: 'media-preview-export',
        file,
        name: 'preview-export.mp4',
        duration: 8,
      },
    ]);

    const previewPlayer = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };
    const exportPlayer = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-preview-export',
      source: {
        type: 'video',
        naturalDuration: 8,
        mediaFileId: 'media-preview-export',
        webCodecsPlayer: asWebCodecsPlayer(previewPlayer),
      },
      file,
      mediaFileId: 'media-preview-export',
    });
    const exportSource = getPolicyRuntimeSource(
      source,
      'export',
      'clip-preview-export'
    );

    setRuntimeFrameProvider(exportSource, asRuntimeProvider(exportPlayer), 'export');

    updateRuntimePlaybackTime(source, 1.25);
    updateRuntimePlaybackTime(exportSource, 4.5, 'export');

    expect(getRuntimeFrameProvider(source)).toBe(previewPlayer);
    expect(getRuntimeFrameProvider(exportSource, 'export')).toBe(exportPlayer);
    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-preview-export',
        'interactive:clip-preview-export'
      )?.currentTime
    ).toBe(1.25);
    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-preview-export',
        'export:clip-preview-export:media:media-preview-export'
      )?.currentTime
    ).toBe(4.5);

    releaseRuntimePlaybackSession(exportSource);

    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-preview-export',
        'interactive:clip-preview-export'
      )
    ).not.toBeNull();
  });

  it('keeps clip-local runtime sessions when multiple clips overlap on the same track', () => {
    const file = new File(['video'], 'overlap.mp4', { type: 'video/mp4', lastModified: 8 });
    setMediaFiles([
      {
        id: 'media-overlap',
        file,
        name: 'overlap.mp4',
        duration: 10,
      },
    ]);

    const player = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-overlap',
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-overlap',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-overlap',
    });

    expect(
      canUseSharedPreviewRuntimeSession(
        { trackId: 'track-1' },
        [{ trackId: 'track-1' }, { trackId: 'track-1' }]
      )
    ).toBe(false);

    const previewSource = getPreviewRuntimeSource(source, 'track-1', false);
    expect(previewSource?.runtimeSessionKey).toBe('interactive:clip-overlap');
  });

  it('creates a dedicated full WebCodecs scrub provider without replacing the playback provider', async () => {
    const file = new File(['video'], 'scrub-separate.mp4', { type: 'video/mp4', lastModified: 81 });
    setMediaFiles([
      {
        id: 'media-scrub-separate',
        file,
        name: 'scrub-separate.mp4',
        duration: 9,
      },
    ]);

    const previewPlayer = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const scrubPlayer = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
      loadFile: vi.fn().mockResolvedValue(undefined),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    vi.mocked(WebCodecsPlayer).mockImplementation(function MockWebCodecsPlayer() {
      return scrubPlayer as unknown as WebCodecsPlayer;
    });

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-scrub-separate',
      source: {
        type: 'video',
        naturalDuration: 9,
        mediaFileId: 'media-scrub-separate',
        webCodecsPlayer: asWebCodecsPlayer(previewPlayer),
      },
      file,
      mediaFileId: 'media-scrub-separate',
    });
    const scrubSource = getScrubRuntimeSource(source, 'track-1', true);

    const provider = await ensureRuntimeFrameProvider(scrubSource, 'interactive', 3.25);

    expect(scrubSource?.runtimeSessionKey).toBe(
      'interactive-scrub:track-1:media:media-scrub-separate'
    );
    expect(provider).toBe(scrubPlayer);
    expect(getRuntimeFrameProvider(source)).toBe(previewPlayer);
    expect(getRuntimeFrameProvider(scrubSource)).toBe(scrubPlayer);
    expect(scrubPlayer.loadFile).toHaveBeenCalledWith(file);
    expect(scrubPlayer.seek).toHaveBeenCalledWith(3.25);
    const resources = timelineRuntimeCoordinator
      .getBridgeStats()
      .policies.interactive.resources
      .filter((resource) => resource.tags?.includes('runtime-playback'));
    expect(resources).toHaveLength(2);
    expect(resources.every((resource) =>
      resource.tags?.includes('runtime-provider-demand') &&
      resource.tags.includes('lease-visible')
    )).toBe(true);

    releaseRuntimePlaybackSession(scrubSource);

    expect(scrubPlayer.destroy).toHaveBeenCalledTimes(1);
    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-scrub-separate',
        'interactive-scrub:track-1:media:media-scrub-separate'
      )
    ).toBeNull();
  });

  it('creates a TurboRes provider for an enabled classic ProRes runtime', async () => {
    const file = new File(['prores'], 'camera.mov', { type: 'video/quicktime', lastModified: 82 });
    setMediaFiles([{
      id: 'media-prores-runtime',
      file,
      name: 'camera.mov',
      duration: 9,
      width: 1920,
      height: 1080,
      codedWidth: 1920,
      codedHeight: 1088,
      fps: 24,
      videoCodecId: 'apch',
    }]);
    const turboResProvider = {
      backend: 'turbores' as const,
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => ({ timestamp: 2_500_000 }) as VideoFrame,
      hasFrame: () => true,
      seek: vi.fn(),
      pause: vi.fn(),
      destroy: vi.fn(),
    };
    const destroyTurboResProvider = turboResProvider.destroy;
    mediaRuntimeMocks.createTurboResFrameProvider.mockResolvedValue(turboResProvider);
    flags.turboResProRes = true;

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-prores-runtime',
      source: {
        type: 'video',
        naturalDuration: 9,
        mediaFileId: 'media-prores-runtime',
      },
      file,
      mediaFileId: 'media-prores-runtime',
    });

    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);
    expect(previewSource?.runtimeSessionKey).toBe(
      'interactive-track:track-1:media:media-prores-runtime',
    );

    const provider = await ensureRuntimeFrameProvider(previewSource, 'interactive', 2.5);

    expect(provider).toBe(turboResProvider);
    expect(mediaRuntimeMocks.createTurboResFrameProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        fourCC: 'apch',
        policy: 'interactive',
        sourceId:
          'media:media-prores-runtime:interactive-track:track-1:media:media-prores-runtime',
      }),
    );
    expect(turboResProvider.seek).toHaveBeenCalledWith(2.5);
    expect(WebCodecsPlayer).not.toHaveBeenCalled();

    const clip = makeClip('clip-prores-runtime', file, source);
    const layerContext = {
      clipsAtTime: [clip],
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      isPlaying: true,
      playbackSpeed: 1,
      playheadPosition: 2.5,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 2.5,
    } as unknown as FrameContext;
    expect(hasLayerBuilderRenderableVideoSource(source, clip)).toBe(true);
    const layerSource = resolveLayerBuilderVideoSource({
      clip,
      ctx: layerContext,
      targetTime: 2.5,
      allowSharedPreviewSession: true,
    });
    expect(layerSource?.source).toMatchObject({
      type: 'video',
      videoElement: undefined,
      webCodecsPlayer: turboResProvider,
      runtimeSessionKey: previewSource?.runtimeSessionKey,
    });

    const providerResource = timelineRuntimeCoordinator
      .getBridgeStats()
      .policies.interactive.resources
      .find((resource) => resource.kind === 'video-frame-provider');
    expect(providerResource).toMatchObject({
      providerKind: 'turbores',
      memoryCost: { heapBytes: expect.any(Number) },
    });

    releaseClipTreeRuntimeBindings(clip);
    expect(mediaRuntimeRegistry.getRuntime('media:media-prores-runtime')).toBeNull();
    expect(
      timelineRuntimeCoordinator
        .getBridgeStats()
        .policies.interactive.resources
        .filter((resource) => resource.tags?.includes('runtime-playback')),
    ).toHaveLength(0);
    expect(destroyTurboResProvider).toHaveBeenCalledOnce();
  });

  it('destroys a TurboRes provider that finishes loading after its clip runtime was released', async () => {
    const file = new File(['prores'], 'late-provider.mov', {
      type: 'video/quicktime',
      lastModified: 83,
    });
    setMediaFiles([{
      id: 'media-prores-late-provider',
      file,
      name: file.name,
      duration: 9,
      width: 1920,
      height: 1080,
      fps: 24,
      videoCodecId: 'apch',
    }]);
    flags.turboResProRes = true;

    let resolveProvider: ((provider: RuntimeFrameProvider) => void) | undefined;
    const providerPromise = new Promise<RuntimeFrameProvider>((resolve) => {
      resolveProvider = resolve;
    });
    const destroyProvider = vi.fn();
    const provider = asRuntimeProvider({
      backend: 'turbores',
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      destroy: destroyProvider,
    });
    mediaRuntimeMocks.createTurboResFrameProvider.mockReturnValue(providerPromise);

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-prores-late-provider',
      source: {
        type: 'video',
        naturalDuration: 9,
        mediaFileId: 'media-prores-late-provider',
      },
      file,
      mediaFileId: 'media-prores-late-provider',
    });
    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);
    const pendingProvider = ensureRuntimeFrameProvider(previewSource, 'interactive', 2.5);

    releaseClipTreeRuntimeBindings(makeClip('clip-prores-late-provider', file, source));
    resolveProvider?.(provider);

    await expect(pendingProvider).resolves.toBeNull();
    expect(destroyProvider).toHaveBeenCalledOnce();
    expect(mediaRuntimeRegistry.getRuntime('media:media-prores-late-provider')).toBeNull();
    expect(
      timelineRuntimeCoordinator
        .getBridgeStats()
        .policies.interactive.resources
        .filter((resource) => resource.tags?.includes('runtime-playback')),
    ).toHaveLength(0);
  });

  it('refreshes late FourCC metadata before choosing a provider', async () => {
    const file = new File(['prores'], 'late-metadata.mov', {
      type: 'video/quicktime',
      lastModified: 84,
    });
    const mediaFile = {
      id: 'media-prores-late-metadata',
      file,
      name: 'late-metadata.mov',
      duration: 1,
      width: 64,
      height: 64,
      fps: 2,
    };
    setMediaFiles([mediaFile]);
    flags.turboResProRes = true;
    const provider = {
      backend: 'turbores' as const,
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      destroy: vi.fn(),
    };
    mediaRuntimeMocks.createTurboResFrameProvider.mockResolvedValue(provider);

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-prores-late-metadata',
      source: {
        type: 'video',
        naturalDuration: 1,
        mediaFileId: mediaFile.id,
      },
      file,
      mediaFileId: mediaFile.id,
    });
    expect(mediaRuntimeRegistry.getRuntime(source!.runtimeSourceId!)?.metadata.videoCodecId)
      .toBeUndefined();

    setMediaFiles([{ ...mediaFile, videoCodecId: 'apch' }]);
    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);
    const selectedProvider = await ensureRuntimeFrameProvider(
      previewSource,
      'interactive',
      0,
    );

    expect(selectedProvider).toBe(provider);
    expect(mediaRuntimeMocks.createTurboResFrameProvider).toHaveBeenCalledWith(
      expect.objectContaining({ file, fourCC: 'apch' }),
    );
    expect(mediaRuntimeRegistry.getRuntime(source!.runtimeSourceId!)?.metadata.videoCodecId)
      .toBe('apch');
    releaseRuntimePlaybackSession(previewSource);
    releaseRuntimePlaybackSession(source);
  });

  it('keeps worker WebCodecs out of dedicated scrub providers even in worker render mode', async () => {
    const restoreCapability = enableWorkerWebCodecsTestCapability();
    try {
      const file = new File(['video'], 'scrub-main-provider.mp4', {
        type: 'video/mp4',
        lastModified: 83,
      });
      setMediaFiles([
        {
          id: 'media-scrub-main-provider',
          file,
          name: 'scrub-main-provider.mp4',
          duration: 9,
        },
      ]);

      const previewPlayer = {
        currentTime: 0,
        isPlaying: false,
        isFullMode: () => true,
        isSimpleMode: () => false,
        getCurrentFrame: () => null,
        seek: vi.fn(),
        pause: vi.fn(),
        getDebugInfo: vi.fn().mockReturnValue(null),
      };

      const scrubPlayer = {
        currentTime: 0,
        isPlaying: false,
        isFullMode: () => true,
        isSimpleMode: () => false,
        getCurrentFrame: () => null,
        seek: vi.fn(),
        pause: vi.fn(),
        destroy: vi.fn(),
        loadFile: vi.fn().mockResolvedValue(undefined),
        getDebugInfo: vi.fn().mockReturnValue(null),
      };

      vi.mocked(WebCodecsPlayer).mockImplementation(function MockWebCodecsPlayer() {
        return scrubPlayer as unknown as WebCodecsPlayer;
      });

      const source = bindSourceRuntimeToClip({
        clipId: 'clip-scrub-main-provider',
        source: {
          type: 'video',
          naturalDuration: 9,
          mediaFileId: 'media-scrub-main-provider',
          webCodecsPlayer: asWebCodecsPlayer(previewPlayer),
        },
        file,
        mediaFileId: 'media-scrub-main-provider',
      });
      const scrubSource = getScrubRuntimeSource(source, 'track-1', true);

      const provider = await ensureRuntimeFrameProvider(scrubSource, 'interactive', 4.25);

      expect(provider).toBe(scrubPlayer);
      expect(createWorkerWebCodecsFrameProvider).not.toHaveBeenCalled();
      expect(WebCodecsPlayer).toHaveBeenCalledTimes(1);
      expect(scrubPlayer.loadFile).toHaveBeenCalledWith(file);
      expect(scrubPlayer.seek).toHaveBeenCalledWith(4.25);
    } finally {
      restoreCapability();
    }
  });

  it('uses worker WebCodecs only when the caller explicitly requests it', async () => {
    const restoreCapability = enableWorkerWebCodecsTestCapability();
    try {
      const file = new File(['video'], 'reverse-worker-provider.mp4', {
        type: 'video/mp4',
        lastModified: 84,
      });
      setMediaFiles([
        {
          id: 'media-reverse-worker-provider',
          file,
          name: 'reverse-worker-provider.mp4',
          duration: 12,
        },
      ]);

      const previewPlayer = {
        currentTime: 0,
        isPlaying: false,
        isFullMode: () => true,
        isSimpleMode: () => false,
        getCurrentFrame: () => null,
        seek: vi.fn(),
        pause: vi.fn(),
        getDebugInfo: vi.fn().mockReturnValue(null),
      };
      const workerProvider = new WorkerWebCodecsFrameProvider({
        sourceId: 'worker-provider',
        file,
      });
      vi.mocked(createWorkerWebCodecsFrameProvider).mockResolvedValue(workerProvider);

      const source = bindSourceRuntimeToClip({
        clipId: 'clip-reverse-worker-provider',
        source: {
          type: 'video',
          naturalDuration: 12,
          mediaFileId: 'media-reverse-worker-provider',
          webCodecsPlayer: asWebCodecsPlayer(previewPlayer),
        },
        file,
        mediaFileId: 'media-reverse-worker-provider',
      });

      const provider = await ensureRuntimeFrameProvider(source, 'interactive', 6.5, {
        preferWorkerWebCodecs: true,
      });

      expect(provider).toBe(workerProvider);
      expect(createWorkerWebCodecsFrameProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          sourceId: 'media:media-reverse-worker-provider:interactive:clip-reverse-worker-provider',
        })
      );
      expect(workerProvider.seek).toHaveBeenCalledWith(6.5);
      expect(workerProvider.advanceToTime).not.toHaveBeenCalled();
      expect(WebCodecsPlayer).not.toHaveBeenCalled();
      expect(getRuntimeFrameProvider(source)).toBe(workerProvider);
    } finally {
      restoreCapability();
    }
  });

  it('clears completed worker WebCodecs provider loads so released sessions can rebuild', async () => {
    const restoreCapability = enableWorkerWebCodecsTestCapability();
    try {
      const file = new File(['video'], 'reverse-worker-rebuild-provider.mp4', {
        type: 'video/mp4',
        lastModified: 84_1,
      });
      setMediaFiles([
        {
          id: 'media-reverse-worker-rebuild-provider',
          file,
          name: 'reverse-worker-rebuild-provider.mp4',
          duration: 12,
        },
      ]);

      const firstProvider = new WorkerWebCodecsFrameProvider({
        sourceId: 'worker-provider-first',
        file,
      });
      const secondProvider = new WorkerWebCodecsFrameProvider({
        sourceId: 'worker-provider-second',
        file,
      });
      vi.mocked(createWorkerWebCodecsFrameProvider)
        .mockResolvedValueOnce(firstProvider)
        .mockResolvedValueOnce(secondProvider);

      const source = bindSourceRuntimeToClip({
        clipId: 'clip-reverse-worker-rebuild-provider',
        source: {
          type: 'video',
          naturalDuration: 12,
          mediaFileId: 'media-reverse-worker-rebuild-provider',
        },
        file,
        mediaFileId: 'media-reverse-worker-rebuild-provider',
      });

      const first = await ensureRuntimeFrameProvider(source, 'interactive', 6.5, {
        preferWorkerWebCodecs: true,
      });
      expect(first).toBe(firstProvider);
      expect(getRuntimeFrameProvider(source)).toBe(firstProvider);

      releaseRuntimePlaybackSession(source);
      expect(firstProvider.destroy).toHaveBeenCalledOnce();

      const second = await ensureRuntimeFrameProvider(source, 'interactive', 5.75, {
        preferWorkerWebCodecs: true,
      });

      expect(second).toBe(secondProvider);
      expect(createWorkerWebCodecsFrameProvider).toHaveBeenCalledTimes(2);
      expect(secondProvider.seek).toHaveBeenCalledWith(5.75);
      expect(getRuntimeFrameProvider(source)).toBe(secondProvider);
    } finally {
      restoreCapability();
    }
  });

  it('can build an explicitly requested worker WebCodecs provider without a main-thread WebCodecs player', async () => {
    const restoreCapability = enableWorkerWebCodecsTestCapability();
    try {
      const file = new File(['video'], 'reverse-worker-no-main-provider.mp4', {
        type: 'video/mp4',
        lastModified: 85,
      });
      setMediaFiles([
        {
          id: 'media-reverse-worker-no-main-provider',
          file,
          name: 'reverse-worker-no-main-provider.mp4',
          duration: 12,
        },
      ]);

      const workerProvider = new WorkerWebCodecsFrameProvider({
        sourceId: 'worker-provider-no-main',
        file,
      });
      vi.mocked(createWorkerWebCodecsFrameProvider).mockResolvedValue(workerProvider);

      const source = bindSourceRuntimeToClip({
        clipId: 'clip-reverse-worker-no-main-provider',
        source: {
          type: 'video',
          naturalDuration: 12,
          mediaFileId: 'media-reverse-worker-no-main-provider',
        },
        file,
        mediaFileId: 'media-reverse-worker-no-main-provider',
      });

      const provider = await ensureRuntimeFrameProvider(source, 'interactive', 6.5, {
        preferWorkerWebCodecs: true,
      });

      expect(provider).toBe(workerProvider);
      expect(createWorkerWebCodecsFrameProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          file,
          sourceId: 'media:media-reverse-worker-no-main-provider:interactive:clip-reverse-worker-no-main-provider',
        })
      );
      expect(workerProvider.seek).toHaveBeenCalledWith(6.5);
      expect(workerProvider.advanceToTime).not.toHaveBeenCalled();
      expect(WebCodecsPlayer).not.toHaveBeenCalled();
      expect(getRuntimeFrameProvider(source)).toBe(workerProvider);
    } finally {
      restoreCapability();
    }
  });

  it('does not construct an interactive runtime provider when frame-provider admission is denied', async () => {
    for (let index = 0; index < 8; index += 1) {
      timelineRuntimeCoordinator.retainResource({
        id: `existing-interactive-provider-${index}`,
        kind: 'video-frame-provider',
        policyId: 'interactive',
        owner: {
          ownerId: `existing-interactive-provider-${index}`,
          ownerType: 'timeline',
        },
        providerId: `existing-interactive-provider-${index}`,
        providerKind: 'webcodecs',
      });
    }

    const file = new File(['video'], 'scrub-denied.mp4', { type: 'video/mp4', lastModified: 82 });
    setMediaFiles([
      {
        id: 'media-scrub-denied',
        file,
        name: 'scrub-denied.mp4',
        duration: 9,
      },
    ]);

    const previewPlayer = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-scrub-denied',
      source: {
        type: 'video',
        naturalDuration: 9,
        mediaFileId: 'media-scrub-denied',
        webCodecsPlayer: asWebCodecsPlayer(previewPlayer),
      },
      file,
      mediaFileId: 'media-scrub-denied',
    });
    const scrubSource = getScrubRuntimeSource(source, 'track-1', true);

    const provider = await ensureRuntimeFrameProvider(scrubSource, 'interactive', 3.25);

    expect(provider).toBeNull();
    expect(WebCodecsPlayer).not.toHaveBeenCalled();
    expect(
      mediaRuntimeRegistry.getSession(
        'media:media-scrub-denied',
        'interactive-scrub:track-1:media:media-scrub-denied'
      )
    ).toBeNull();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.budgetReport.usage.frameProviders).toBe(8);
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources).toHaveLength(8);
  });

  it('reuses a shared cached frame across simultaneous same-source sessions at the same source time', () => {
    const file = new File(['video'], 'simul.mp4', { type: 'video/mp4', lastModified: 9 });
    setMediaFiles([
      {
        id: 'media-simul',
        file,
        name: 'simul.mp4',
        duration: 12,
      },
    ]);

    const playerA = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => makeCloneableVideoFrame(2_000_000),
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };
    const playerB = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const sourceA = bindSourceRuntimeToClip({
      clipId: 'clip-simul-a',
      source: {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-simul',
        webCodecsPlayer: asWebCodecsPlayer(playerA),
      },
      file,
      mediaFileId: 'media-simul',
    });
    const sourceB = bindSourceRuntimeToClip({
      clipId: 'clip-simul-b',
      source: {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-simul',
        webCodecsPlayer: asWebCodecsPlayer(playerB),
      },
      file,
      mediaFileId: 'media-simul',
    });

    const previewSourceA = getPreviewRuntimeSource(sourceA, 'track-1', true);
    const previewSourceB = getPreviewRuntimeSource(sourceB, 'track-2', true);

    updateRuntimePlaybackTime(previewSourceA, 2);
    updateRuntimePlaybackTime(previewSourceB, 2);

    const runtimeFrame = readRuntimeFrameForSource(previewSourceB);

    expect(runtimeFrame?.frameHandle?.frame).not.toBeNull();
    expect(runtimeFrame?.frameHandle?.timestamp).toBe(2_000_000);
    expect(mediaRuntimeRegistry.getRuntime('media:media-simul')?.frameCache.size).toBe(1);
  });

  it('does not reuse a simultaneous session frame when the requested source times differ', () => {
    const file = new File(['video'], 'simul-drift.mp4', { type: 'video/mp4', lastModified: 10 });
    setMediaFiles([
      {
        id: 'media-simul-drift',
        file,
        name: 'simul-drift.mp4',
        duration: 12,
      },
    ]);

    const playerA = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => makeCloneableVideoFrame(2_000_000),
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };
    const playerB = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const sourceA = bindSourceRuntimeToClip({
      clipId: 'clip-simul-drift-a',
      source: {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-simul-drift',
        webCodecsPlayer: asWebCodecsPlayer(playerA),
      },
      file,
      mediaFileId: 'media-simul-drift',
    });
    const sourceB = bindSourceRuntimeToClip({
      clipId: 'clip-simul-drift-b',
      source: {
        type: 'video',
        naturalDuration: 12,
        mediaFileId: 'media-simul-drift',
        webCodecsPlayer: asWebCodecsPlayer(playerB),
      },
      file,
      mediaFileId: 'media-simul-drift',
    });

    const previewSourceA = getPreviewRuntimeSource(sourceA, 'track-1', true);
    const previewSourceB = getPreviewRuntimeSource(sourceB, 'track-2', true);

    updateRuntimePlaybackTime(previewSourceA, 2);
    updateRuntimePlaybackTime(previewSourceB, 4);

    const runtimeFrame = readRuntimeFrameForSource(previewSourceB);

    expect(runtimeFrame?.frameHandle).toBeNull();
    expect(mediaRuntimeRegistry.getRuntime('media:media-simul-drift')?.frameCache.size).toBe(0);
  });

  it('bounds the shared frame cache and releases evicted cached frames', () => {
    const file = new File(['video'], 'cache.mp4', { type: 'video/mp4', lastModified: 11 });
    const cachedCloneCloseSpies: Array<ReturnType<typeof vi.fn>> = [];
    let currentFrame = makeCloneableVideoFrame(0, cachedCloneCloseSpies);

    setMediaFiles([
      {
        id: 'media-cache',
        file,
        name: 'cache.mp4',
        duration: 20,
      },
    ]);

    const player = {
      currentTime: 0,
      isPlaying: false,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => currentFrame,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-cache',
      source: {
        type: 'video',
        naturalDuration: 20,
        mediaFileId: 'media-cache',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-cache',
    });

    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);

    for (let i = 0; i < 13; i++) {
      currentFrame = makeCloneableVideoFrame(i * 1_000_000, cachedCloneCloseSpies);
      updateRuntimePlaybackTime(previewSource, i);
      readRuntimeFrameForSource(previewSource);
    }

    const runtime = mediaRuntimeRegistry.getRuntime('media:media-cache');

    expect(runtime?.frameCache.size).toBeLessThanOrEqual(12);
    expect(cachedCloneCloseSpies[0]).toHaveBeenCalled();
  });

  it('does not return or cache a stale provider frame for a new requested time', () => {
    const file = new File(['video'], 'stale-provider.mp4', { type: 'video/mp4', lastModified: 12 });
    setMediaFiles([
      {
        id: 'media-stale-provider',
        file,
        name: 'stale-provider.mp4',
        duration: 120,
        fps: 30,
      },
    ]);

    const staleFrame = makeCloneableVideoFrame(72_506_000);
    const player = {
      currentTime: 7.623,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => staleFrame,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
      getFrameRate: () => 30,
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-stale-provider',
      source: {
        type: 'video',
        naturalDuration: 120,
        mediaFileId: 'media-stale-provider',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-stale-provider',
    });

    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);
    updateRuntimePlaybackTime(previewSource, 7.623);

    const runtimeFrame = readRuntimeFrameForSource(previewSource);

    expect(runtimeFrame?.frameHandle).toBeNull();
    expect(mediaRuntimeRegistry.getRuntime('media:media-stale-provider')?.frameCache.size).toBe(0);
  });

  it('uses provider debug time to reject stale ImageBitmap provider frames', () => {
    const file = new File(['video'], 'stale-bitmap-provider.mp4', { type: 'video/mp4', lastModified: 12_1 });
    setMediaFiles([
      {
        id: 'media-stale-bitmap-provider',
        file,
        name: 'stale-bitmap-provider.mp4',
        duration: 120,
        fps: 30,
      },
    ]);

    const staleBitmap = {
      width: 1920,
      height: 1080,
      close: vi.fn(),
    } as unknown as VideoFrame;
    const player = {
      currentTime: 7.623,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => staleBitmap,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue({
        codec: 'vp9',
        hwAccel: 'unknown',
        decodeQueueSize: 0,
        samplesLoaded: 1,
        sampleIndex: 0,
        currentFrameTimestampSeconds: 72.506,
      }),
      getFrameRate: () => 30,
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-stale-bitmap-provider',
      source: {
        type: 'video',
        naturalDuration: 120,
        mediaFileId: 'media-stale-bitmap-provider',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-stale-bitmap-provider',
    });

    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);
    updateRuntimePlaybackTime(previewSource, 7.623);

    const runtimeFrame = readRuntimeFrameForSource(previewSource);

    expect(runtimeFrame?.frameHandle).toBeNull();
    expect(mediaRuntimeRegistry.getRuntime('media:media-stale-bitmap-provider')?.frameCache.size).toBe(0);
  });

  it('ignores a stale cached frame that was previously bound to the wrong requested time', () => {
    const file = new File(['video'], 'stale-cache.mp4', { type: 'video/mp4', lastModified: 13 });
    setMediaFiles([
      {
        id: 'media-stale-cache',
        file,
        name: 'stale-cache.mp4',
        duration: 120,
        fps: 30,
      },
    ]);

    const player = {
      currentTime: 7.623,
      isPlaying: true,
      isFullMode: () => true,
      isSimpleMode: () => false,
      getCurrentFrame: () => null,
      seek: vi.fn(),
      pause: vi.fn(),
      getDebugInfo: vi.fn().mockReturnValue(null),
      getFrameRate: () => 30,
    };

    const source = bindSourceRuntimeToClip({
      clipId: 'clip-stale-cache',
      source: {
        type: 'video',
        naturalDuration: 120,
        mediaFileId: 'media-stale-cache',
        webCodecsPlayer: asWebCodecsPlayer(player),
      },
      file,
      mediaFileId: 'media-stale-cache',
    });

    const previewSource = getPreviewRuntimeSource(source, 'track-1', true);
    updateRuntimePlaybackTime(previewSource, 7.623);

    const runtime = mediaRuntimeRegistry.getRuntime('media:media-stale-cache');
    runtime?.cacheFrame(
      { sourceTime: 7.623, frameNumber: undefined },
      makeCloneableVideoFrame(72_506_000),
      { timestamp: 72_506_000 }
    );

    const runtimeFrame = readRuntimeFrameForSource(previewSource);

    expect(runtimeFrame?.frameHandle).toBeNull();
    expect(runtime?.frameCache.size).toBe(0);
  });
});
