import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineClipCanvas } from '../../src/components/timeline/TimelineClipCanvas';
import type { TimelinePaintSourceClip } from '../../src/timeline';
import type { ClipDragState, ClipTrimState } from '../../src/components/timeline/types';
import { flags } from '../../src/engine/featureFlags';
import {
  evictTimelineSpectrogramTileSetRefs,
  primeTimelineSpectrogramTileSetCache,
  type TimelineSpectrogramTileSet,
} from '../../src/services/audio/timelineSpectrogramCache';
import { thumbnailCacheService } from '../../src/services/thumbnailCacheService';
import * as thumbnailBitmapCache from '../../src/services/timeline/thumbnailBitmapCache';
import {
  clearTimelineCanvasDiagnostics,
  getTimelineCanvasDiagnostics,
} from '../../src/services/timeline/timelineCanvasDiagnostics';
import type { TimelineAudioDisplayMode, TimelineClipDragPreview } from '../../src/stores/timeline/types';

// The OffscreenCanvas worker path is gated off on Linux/Mesa
// (prefersSoftwareTimelineCanvas). The test environment reports Linux, which
// would disable the worker and make these worker-path assertions fail, so force
// the gate to non-Linux here. The Linux software-path behavior is intentional in
// production (see docs/Features/Linux-Mesa-GPU.md).
vi.mock('../../src/components/timeline/utils/timelineCanvasPlatform', () => ({
  prefersSoftwareTimelineCanvas: () => false,
}));

interface WorkerTotals {
  workerTrackCount: number;
  workerEligibleTrackCount: number;
  workerFallbackTrackCount: number;
  workerPendingTrackCount: number;
  workerDrawReportCount: number;
  workerDrawMsMax: number;
  workerResourceBytes: number;
  workerErrorTrackCount: number;
  workerErrors: Record<string, number>;
}

interface PostedWorkerMessage {
  type: string;
  requestId?: number;
  paintResources?: {
    schemaVersion?: number;
    resources?: Array<{ id?: string; kind?: string; ownerClipId?: string }>;
  };
  paintPayloads?: {
    thumbnailStrips?: Array<{
      resourceId?: string;
      resource: {
        bitmap?: ImageBitmap;
        drawCount?: number;
      };
    }>;
    waveforms?: Array<{
      resourceId?: string;
      resource: {
        columns?: Float32Array;
      };
    }>;
    spectrograms?: Array<{
      resourceId?: string;
      resource: {
        values?: Float32Array;
        rasterWidth?: number;
        rasterHeight?: number;
      };
    }>;
    midiPreviews?: Array<{
      resourceId?: string;
      resource: {
        bars?: Float32Array;
      };
    }>;
    fadeVisuals?: Array<{
      resourceId?: string;
      resource: {
        curves?: Float32Array;
        curveCount?: number;
        points?: Float32Array;
        pointCount?: number;
        isAudioClip?: boolean;
      };
    }>;
    trimVisuals?: Array<{
      facetId?: string;
      resource: {
        body?: { x?: number; width?: number };
        sourceExtensionGhosts?: Array<{ edge?: 'left' | 'right'; x?: number; width?: number }>;
      };
    }>;
    passiveDecorations?: Array<{
      facetId?: string;
      resource: {
        kind?: string;
        badges?: Array<{ label?: string }>;
        progressBars?: Array<{ progress?: number }>;
        transcriptMarkers?: Float32Array;
        analysisOverlay?: {
          points?: Float32Array;
          pointCount?: number;
        };
      };
    }>;
    compositionVisuals?: Array<{
      facetId?: string;
      resource: {
        outline?: boolean;
        nestedBoundaries?: Float32Array;
        segmentRects?: Float32Array;
        segmentThumbnailStrip?: {
          bitmap?: ImageBitmap;
          width?: number;
          height?: number;
          drawCount?: number;
        };
        mixdownWaveform?: { columns?: Float32Array; columnCount?: number };
        mixdownGenerating?: boolean;
      };
    }>;
  };
  clips?: Array<{
    id?: string;
    paintPacket?: {
      clipId?: string;
      trackId?: string;
      bodyRect?: { x?: number; width?: number };
      label?: string;
      state?: {
        selected?: boolean;
        hovered?: boolean;
      };
    };
    thumbnailStrip?: {
      bitmap?: ImageBitmap;
      x?: number;
      width?: number;
      height?: number;
      drawCount?: number;
    };
    trimVisuals?: {
      body?: { x?: number; width?: number };
      sourceExtensionGhosts?: Array<{ edge?: 'left' | 'right'; x?: number; width?: number }>;
    };
    fadeVisuals?: {
      curves?: Float32Array;
      curveCount?: number;
      points?: Float32Array;
      pointCount?: number;
      isAudioClip?: boolean;
    };
    waveform?: { columns?: Float32Array };
    spectrogram?: { values?: Float32Array; rasterWidth?: number; rasterHeight?: number };
  }>;
}

class FakeTimelineCanvasWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postedMessages: PostedWorkerMessage[] = [];
  postedTransferables: unknown[][] = [];
  postMessage = vi.fn((message: PostedWorkerMessage, transferables?: unknown[]) => {
    this.postedMessages.push(message);
    this.postedTransferables.push(transferables ?? []);
  });
  terminate = vi.fn();

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const originalTimelineCanvasWorkerFlag = flags.timelineCanvasWorker;
const originalTransferDescriptor = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  'transferControlToOffscreen',
);
let workers: FakeTimelineCanvasWorker[] = [];

function createClip(overrides: Partial<TimelinePaintSourceClip> = {}): TimelinePaintSourceClip {
  return {
    id: 'clip-solid',
    trackId: 'track-worker',
    trackType: 'video',
    startTime: 1,
    duration: 3,
    name: 'Solid Clip',
    source: { type: 'solid', naturalDuration: 3 },
    ...overrides,
  };
}

function createCanvasContextMock(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D;
}

function installFakeOffscreenCanvas(createdBitmaps: ImageBitmap[]): void {
  vi.stubGlobal('OffscreenCanvas', class FakeOffscreenCanvas {
    width: number;
    height: number;

    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        drawImage: vi.fn(),
      };
    }

    transferToImageBitmap() {
      const bitmap = {
        width: this.width,
        height: this.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
      createdBitmaps.push(bitmap);
      return bitmap;
    }
  });
}

function renderWorkerCanvas(options: {
  clips?: readonly TimelinePaintSourceClip[];
  selectedClipIds?: ReadonlySet<string>;
  hoveredClipId?: string | null;
  waveformsEnabled?: boolean;
  audioDisplayMode?: TimelineAudioDisplayMode;
  clipDrag?: ClipDragState | null;
  clipDragPreview?: TimelineClipDragPreview | null;
  clipTrim?: ClipTrimState | null;
} = {}) {
  return render(
    <TimelineClipCanvas
      clips={options.clips ?? [createClip()]}
      trackId="track-worker"
      height={48}
      contentWidth={500}
      timeToPixel={(time) => time * 10}
      selectedClipIds={options.selectedClipIds ?? new Set(['clip-solid'])}
      hoveredClipId={options.hoveredClipId ?? 'clip-solid'}
      trackColor="#4c9aff"
      scrollX={0}
      viewportWidth={200}
      waveformsEnabled={options.waveformsEnabled ?? false}
      audioDisplayMode={options.audioDisplayMode ?? 'detailed'}
      clipDrag={options.clipDrag}
      clipDragPreview={options.clipDragPreview}
      clipTrim={options.clipTrim}
    />,
  );
}

function getWorkerTotals(): WorkerTotals {
  const diagnostics = getTimelineCanvasDiagnostics() as { totals: WorkerTotals };
  return diagnostics.totals;
}

describe('TimelineClipCanvas worker runtime', () => {
  beforeEach(() => {
    clearTimelineCanvasDiagnostics();
    flags.timelineCanvasWorker = true;
    workers = [];

    vi.stubGlobal('Worker', vi.fn(function WorkerMock() {
      const worker = new FakeTimelineCanvasWorker();
      workers.push(worker);
      return worker;
    }));
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      configurable: true,
      value: vi.fn(() => ({ kind: 'offscreen-canvas' })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => createCanvasContextMock());
  });

  afterEach(() => {
    flags.timelineCanvasWorker = originalTimelineCanvasWorkerFlag;
    clearTimelineCanvasDiagnostics();
    evictTimelineSpectrogramTileSetRefs(['spectrogram-ref']);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    if (originalTransferDescriptor) {
      Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', originalTransferDescriptor);
    } else {
      delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).transferControlToOffscreen;
    }
  });

  it('queues the first draw until ready, records draw acks, and falls back after worker failure', async () => {
    const { container } = renderWorkerCanvas();

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];
    const initialCanvas = container.querySelector('canvas');

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postedMessages[0]).toMatchObject({ type: 'init' });
    expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(false);

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawMessage = worker.postedMessages.find((message) => message.type === 'draw');
    expect(drawMessage).toMatchObject({
      type: 'draw',
      requestId: 1,
      paintResources: {
        schemaVersion: 1,
        resources: [],
      },
      paintPayloads: {
        thumbnailStrips: [],
        waveforms: [],
        spectrograms: [],
        midiPreviews: [],
        fadeVisuals: [],
        trimVisuals: [],
        passiveDecorations: [],
        compositionVisuals: [],
      },
      clips: [{
        id: 'clip-solid',
        paintPacket: {
          clipId: 'clip-solid',
          trackId: 'track-worker',
          bodyRect: { x: 10, width: 30 },
          label: 'Solid Clip',
          state: {
            selected: true,
            hovered: true,
          },
        },
      }],
      height: 48,
      cssWidth: 2600,
      trackColor: '#4c9aff',
    });

    await act(async () => {
      worker.emit({
        type: 'drawn',
        requestId: drawMessage?.requestId,
        drawnClipCount: 1,
        drawMs: 1.25,
        resourceBytes: 4096,
      });
    });

    await waitFor(() => {
      const totals = getWorkerTotals();
      expect(totals.workerTrackCount).toBe(1);
      expect(totals.workerEligibleTrackCount).toBe(1);
      expect(totals.workerPendingTrackCount).toBe(0);
      expect(totals.workerDrawReportCount).toBe(1);
      expect(totals.workerDrawMsMax).toBe(1.25);
      expect(totals.workerResourceBytes).toBe(4096);
    });

    await act(async () => {
      worker.onmessageerror?.({ data: null } as MessageEvent);
    });

    await waitFor(() => {
      const totals = getWorkerTotals();
      expect(totals.workerTrackCount).toBe(0);
      expect(totals.workerFallbackTrackCount).toBe(1);
      expect(totals.workerErrorTrackCount).toBe(1);
      expect(totals.workerErrors).toEqual({ 'worker-messageerror': 1 });
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(container.querySelector('canvas')).not.toBe(initialCanvas);
  });

  it('posts prepared waveform columns with a transfer list for eligible audio clips', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-audio',
        trackType: 'audio',
        source: { type: 'audio', naturalDuration: 3 },
        waveform: [0, 0.4, -0.2, 0.8, -0.1, 0.3],
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
      waveformsEnabled: true,
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const waveform = drawMessage.paintPayloads?.waveforms?.[0]?.resource;
    expect(waveform?.columns).toBeInstanceOf(Float32Array);
    expect(waveform?.columns?.length).toBeGreaterThan(0);
    expect(worker.postedTransferables[drawIndex]).toHaveLength(1);
    expect(worker.postedTransferables[drawIndex][0]).toBe(waveform?.columns?.buffer);
  });

  it('posts active trim body geometry and source-extension ghosts to the worker', async () => {
    const clip = createClip({
      id: 'clip-trim',
      startTime: 1,
      duration: 3,
      inPoint: 0,
      outPoint: 3,
      source: { type: 'solid', naturalDuration: 3 },
    });

    renderWorkerCanvas({
      clips: [clip],
      selectedClipIds: new Set(),
      hoveredClipId: null,
      clipTrim: {
        clipId: 'clip-trim',
        edge: 'right',
        originalStartTime: 1,
        originalDuration: 3,
        originalInPoint: 0,
        originalOutPoint: 3,
        startX: 40,
        currentX: 60,
        altKey: false,
        snapIndicatorTime: null,
        isSnapping: false,
        appliedDelta: 2,
      },
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const postedClip = drawMessage.clips?.[0];

    expect(postedClip?.paintPacket?.bodyRect).toMatchObject({ x: 10, width: 50 });
    expect(drawMessage.paintPayloads?.trimVisuals?.[0]?.resource).toMatchObject({
      kind: 'trim-visuals',
      body: {
        x: 10,
        width: 50,
      },
      sourceExtensionGhosts: [
        {
          edge: 'right',
          x: 40,
          width: 20,
        },
      ],
    });
    expect(worker.postedTransferables[drawIndex]).toEqual([]);
  });

  it('posts resolved active drag geometry instead of falling back', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-drag',
        startTime: 1,
        duration: 3,
      })],
      selectedClipIds: new Set(['clip-drag']),
      hoveredClipId: null,
      clipDrag: {
        clipId: 'clip-drag',
        originalStartTime: 1,
        originalTrackId: 'track-worker',
        grabOffsetX: 0,
        grabY: 0,
        currentX: 0,
        currentTrackId: 'track-worker',
        snappedTime: 5,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        altKeyPressed: false,
        forcingOverlap: false,
        dragStartTime: 0,
      },
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawMessage = worker.postedMessages.find((message) => message.type === 'draw');
    expect(drawMessage?.clips).toEqual([expect.objectContaining({
      id: 'clip-drag',
      paintPacket: expect.objectContaining({
        bodyRect: expect.objectContaining({ x: 50, width: 30 }),
        state: expect.objectContaining({ selected: true }),
      }),
    })]);
  });

  it('posts resolved slide tool geometry instead of falling back', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-slide',
        startTime: 1,
        duration: 3,
      })],
      selectedClipIds: new Set(['clip-slide']),
      hoveredClipId: null,
      clipDrag: {
        clipId: 'clip-slide',
        toolGesture: 'slide',
        originalStartTime: 1,
        originalTrackId: 'track-worker',
        grabOffsetX: 0,
        grabY: 0,
        gestureStartX: 0,
        currentX: 30,
        currentTrackId: 'track-worker',
        snappedTime: 4,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        altKeyPressed: false,
        forcingOverlap: false,
        dragStartTime: 0,
        multiSelectTimeDelta: 3,
      },
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawMessage = worker.postedMessages.find((message) => message.type === 'draw');
    expect(drawMessage?.clips).toEqual([expect.objectContaining({
      id: 'clip-slide',
      paintPacket: expect.objectContaining({
        bodyRect: expect.objectContaining({ x: 40, width: 30 }),
        state: expect.objectContaining({ selected: true }),
      }),
    })]);
  });

  it('posts slip tool thumbnail resources from the shifted source range', async () => {
    const cacheBitmap = {
      width: 320,
      height: 180,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createdStripBitmaps: ImageBitmap[] = [];
    installFakeOffscreenCanvas(createdStripBitmaps);
    const getThumbnailsForRangeSpy = vi.spyOn(thumbnailCacheService, 'getThumbnailsForRange').mockReturnValue(['blob:thumb-slip']);
    vi.spyOn(thumbnailBitmapCache, 'hasThumbnailBitmap').mockReturnValue(true);
    vi.spyOn(thumbnailBitmapCache, 'getThumbnailBitmap').mockReturnValue(cacheBitmap);

    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-slip',
        name: 'Slip Video',
        duration: 4,
        inPoint: 1,
        outPoint: 5,
        mediaFileId: 'media-slip',
        source: { type: 'video', mediaFileId: 'media-slip', naturalDuration: 10 },
      })],
      selectedClipIds: new Set(['clip-slip']),
      hoveredClipId: null,
      clipDrag: {
        clipId: 'clip-slip',
        toolGesture: 'slip',
        originalStartTime: 1,
        originalTrackId: 'track-worker',
        grabOffsetX: 0,
        grabY: 0,
        gestureStartX: 0,
        currentX: 20,
        currentTrackId: 'track-worker',
        snappedTime: 1,
        snapIndicatorTime: null,
        isSnapping: false,
        trackChangeGuideTime: null,
        altKeyPressed: false,
        forcingOverlap: false,
        dragStartTime: 0,
        sourceTimeDelta: 2,
      },
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const thumbnailStrip = drawMessage.paintPayloads?.thumbnailStrips?.[0]?.resource;
    const thumbnailArgs = getThumbnailsForRangeSpy.mock.calls[0];

    expect(thumbnailArgs?.[0]).toBe('media-slip');
    expect(thumbnailArgs?.[1]).toBeCloseTo(3);
    expect(thumbnailArgs?.[2]).toBeCloseTo(7);
    expect(thumbnailStrip?.bitmap).toBe(createdStripBitmaps[0]);
    expect(drawMessage.clips).toEqual([expect.objectContaining({
      id: 'clip-slip',
      paintPacket: expect.objectContaining({
        bodyRect: expect.objectContaining({ x: 10, width: 40 }),
        state: expect.objectContaining({ selected: true }),
      }),
    })]);
    expect(worker.postedTransferables[drawIndex]).toEqual([thumbnailStrip?.bitmap]);
    expect(worker.postedTransferables[drawIndex]).not.toContain(cacheBitmap);
    expect(cacheBitmap.close).not.toHaveBeenCalled();
  });

  it('posts cross-track drag preview geometry for the target track', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-preview',
        trackId: 'track-source',
        startTime: 1,
        duration: 3,
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
      clipDragPreview: {
        patches: {
          'clip-preview': {
            startTime: 6,
            trackId: 'track-worker',
          },
        },
      },
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawMessage = worker.postedMessages.find((message) => message.type === 'draw');
    expect(drawMessage?.clips).toEqual([expect.objectContaining({
      id: 'clip-preview',
      paintPacket: expect.objectContaining({
        bodyRect: expect.objectContaining({ x: 60, width: 30 }),
      }),
    })]);
  });

  it('posts prepared fade curve geometry with transferables for eligible clips', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-fade',
        trackType: 'audio',
        startTime: 1,
        duration: 3,
        source: { type: 'audio', naturalDuration: 3 },
        fade: {
          clipDuration: 3,
          isAudioClip: true,
          keyframes: [
            { time: 0, value: 0, easing: 'linear' },
            { time: 3, value: 1, easing: 'linear' },
          ],
        },
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const fadeVisuals = drawMessage.paintPayloads?.fadeVisuals?.[0]?.resource;

    expect(fadeVisuals?.curves).toBeInstanceOf(Float32Array);
    expect(fadeVisuals?.points).toBeInstanceOf(Float32Array);
    expect(fadeVisuals?.curveCount).toBe(1);
    expect(fadeVisuals?.pointCount).toBe(2);
    expect(fadeVisuals?.isAudioClip).toBe(true);
    expect(Array.from(fadeVisuals?.points ?? [])).toEqual([
      0,
      46,
      30,
      0,
    ]);
    expect(worker.postedTransferables[drawIndex]).toEqual([
      fadeVisuals?.curves?.buffer,
      fadeVisuals?.points?.buffer,
    ]);
  });

  it('posts prepared composition visuals with a transfer-owned segment bitmap', async () => {
    const cacheBitmap = {
      width: 320,
      height: 180,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createdStripBitmaps: ImageBitmap[] = [];
    installFakeOffscreenCanvas(createdStripBitmaps);
    vi.spyOn(thumbnailBitmapCache, 'hasThumbnailBitmap').mockReturnValue(true);
    vi.spyOn(thumbnailBitmapCache, 'getThumbnailBitmap').mockReturnValue(cacheBitmap);

    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-comp',
        isComposition: true,
        compositionId: 'comp-1',
        nestedClipBoundaries: [0.25, 0.75],
        clipSegments: [
          { clipId: 'nested-1', clipName: 'Nested 1', startNorm: 0, endNorm: 1, thumbnails: ['blob:segment-thumb'] },
        ],
        mixdownWaveform: [0, 0.4, -0.2, 0.8],
        mixdownGenerating: true,
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const compositionVisuals = drawMessage.paintPayloads?.compositionVisuals?.[0]?.resource;

    expect(createdStripBitmaps).toHaveLength(1);
    expect('compositionVisuals' in (drawMessage.clips?.[0] ?? {})).toBe(false);
    expect(compositionVisuals?.outline).toBe(true);
    expect(Array.from(compositionVisuals?.nestedBoundaries ?? [])).toEqual([
      expect.closeTo(0.25),
      expect.closeTo(0.75),
    ]);
    expect(Array.from(compositionVisuals?.segmentRects ?? [])).toEqual([
      0,
      1,
    ]);
    expect(compositionVisuals?.segmentThumbnailStrip?.bitmap).toBe(createdStripBitmaps[0]);
    expect(compositionVisuals?.segmentThumbnailStrip?.drawCount).toBe(1);
    expect(compositionVisuals?.mixdownWaveform?.columns).toBeInstanceOf(Float32Array);
    expect(compositionVisuals?.mixdownGenerating).toBe(true);
    expect(worker.postedTransferables[drawIndex]).toContain(createdStripBitmaps[0]);
    expect(worker.postedTransferables[drawIndex]).toContain(compositionVisuals?.nestedBoundaries?.buffer);
    expect(worker.postedTransferables[drawIndex]).toContain(compositionVisuals?.segmentRects?.buffer);
    expect(worker.postedTransferables[drawIndex]).toContain(compositionVisuals?.mixdownWaveform?.columns?.buffer);
    expect(worker.postedTransferables[drawIndex]).not.toContain(cacheBitmap);
    expect(cacheBitmap.close).not.toHaveBeenCalled();
  });

  it('posts fresh reversed thumbnail strip bitmaps without transferring cache-owned bitmaps', async () => {
    const cacheBitmap = {
      width: 320,
      height: 180,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createdStripBitmaps: ImageBitmap[] = [];
    installFakeOffscreenCanvas(createdStripBitmaps);
    const getThumbnailsForRangeSpy = vi.spyOn(thumbnailCacheService, 'getThumbnailsForRange').mockReturnValue(['blob:thumb-1', 'blob:thumb-2']);
    vi.spyOn(thumbnailBitmapCache, 'hasThumbnailBitmap').mockReturnValue(true);
    vi.spyOn(thumbnailBitmapCache, 'getThumbnailBitmap').mockReturnValue(cacheBitmap);

    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-video',
        name: 'Video Clip',
        duration: 16,
        mediaFileId: 'media-1',
        reversed: true,
        source: { type: 'video', mediaFileId: 'media-1', naturalDuration: 16 },
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const thumbnailStrip = drawMessage.paintPayloads?.thumbnailStrips?.[0]?.resource;
    const passiveDecorations = drawMessage.paintPayloads?.passiveDecorations?.[0]?.resource;
    expect(createdStripBitmaps).toHaveLength(1);
    expect(thumbnailStrip?.bitmap).toBe(createdStripBitmaps[0]);
    expect(thumbnailStrip?.drawCount).toBe(2);
    expect(passiveDecorations?.badges?.map((badge) => badge.label)).toContain('R');
    expect(getThumbnailsForRangeSpy).toHaveBeenCalledWith(
      'media-1',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      true,
    );
    expect(worker.postedTransferables[drawIndex]).toEqual([thumbnailStrip?.bitmap]);
    expect(worker.postedTransferables[drawIndex]).not.toContain(cacheBitmap);
    expect(cacheBitmap.close).not.toHaveBeenCalled();
  });

  it('posts simple passive badge decorations for eligible clips', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-linked',
        linkedGroupId: 'group-1',
        reversed: true,
        transcriptStatus: 'ready',
        transcript: [
          { id: 'w1', word: 'hello', start: 1.2, end: 1.6 },
          { id: 'w2', word: 'world', start: 2.2, end: 2.7 },
        ],
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawMessage = worker.postedMessages.find((message) => message.type === 'draw');
    const passiveDecorations = drawMessage?.paintPayloads?.passiveDecorations?.[0]?.resource;
    expect(passiveDecorations?.kind).toBe('passive-decorations');
    expect(passiveDecorations?.badges?.map((badge) => badge.label)).toContain('L');
    expect(passiveDecorations?.badges?.map((badge) => badge.label)).toContain('R');
    const markers = passiveDecorations?.transcriptMarkers;
    expect(markers).toBeInstanceOf(Float32Array);
    expect(markers?.length).toBe(4);
    expect(Array.from(markers ?? [])).toEqual([
      expect.closeTo((3 - 1.6) / 3),
      expect.closeTo((3 - 1.2) / 3),
      expect.closeTo((3 - 2.7) / 3),
      expect.closeTo((3 - 2.2) / 3),
    ]);
  });

  it('posts sampled analysis overlays for eligible video clips', async () => {
    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-analysis',
        duration: 8,
        reversed: true,
        analysisStatus: 'ready',
        analysis: {
          frames: [
            { timestamp: 1, focus: 0.2, globalMotion: 0.1, faceCount: 0 },
            { timestamp: 2, focus: 0.5, motion: 0.4, faceCount: 1 },
            { timestamp: 4, focus: 0.9, globalMotion: 0.2, faceCount: 0 },
            { timestamp: 7, focus: 0.4, motion: 0.1, faceCount: 2 },
          ],
        } as TimelinePaintSourceClip['analysis'],
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const passiveDecorations = drawMessage.paintPayloads?.passiveDecorations?.[0]?.resource;
    const analysisOverlay = passiveDecorations?.analysisOverlay;
    expect(passiveDecorations?.badges?.map((badge) => badge.label)).toContain('AN');
    expect(passiveDecorations?.badges?.map((badge) => badge.label)).toContain('R');
    expect(analysisOverlay?.points).toBeInstanceOf(Float32Array);
    expect(analysisOverlay?.pointCount).toBeGreaterThanOrEqual(2);
    expect(analysisOverlay?.points?.length).toBe((analysisOverlay?.pointCount ?? 0) * 4);
    const analysisPointCount = analysisOverlay?.pointCount ?? 0;
    expect(analysisOverlay?.points?.[0]).toBeCloseTo((8 - 1) / 8);
    expect(analysisOverlay?.points?.[(analysisPointCount - 1) * 4]).toBeCloseTo((8 - 7) / 8);
    expect(worker.postedTransferables[drawIndex]).toEqual([analysisOverlay?.points?.buffer]);
  });

  it('posts prepared spectrogram values with a transfer list for eligible spectral audio clips', async () => {
    const tileSet: TimelineSpectrogramTileSet = {
      sampleRate: 48_000,
      duration: 3,
      fftSize: 1024,
      hopSize: 512,
      minDb: -80,
      maxDb: 0,
      frameCount: 4,
      frequencyBinCount: 3,
      channels: [{
        channelIndex: 0,
        values: new Float32Array([
          0.05, 0.15, 0.25,
          0.35, 0.45, 0.55,
          0.65, 0.75, 0.85,
          0.95, 0.5, 0.1,
        ]),
      }],
    };
    primeTimelineSpectrogramTileSetCache(['spectrogram-ref'], tileSet);

    renderWorkerCanvas({
      clips: [createClip({
        id: 'clip-spectral',
        trackType: 'audio',
        source: { type: 'audio', naturalDuration: 3 },
        audioState: {
          sourceAnalysisRefs: { spectrogramTileSetIds: ['spectrogram-ref'] },
        },
      })],
      selectedClipIds: new Set(),
      hoveredClipId: null,
      waveformsEnabled: true,
      audioDisplayMode: 'spectral',
    });

    await waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];

    await act(async () => {
      worker.emit({ type: 'ready' });
    });

    await waitFor(() => {
      expect(worker.postedMessages.some((message) => message.type === 'draw')).toBe(true);
    });
    const drawIndex = worker.postedMessages.findIndex((message) => message.type === 'draw');
    const drawMessage = worker.postedMessages[drawIndex];
    const spectrogram = drawMessage.paintPayloads?.spectrograms?.[0]?.resource;
    expect(spectrogram?.values).toBeInstanceOf(Float32Array);
    expect(spectrogram?.values?.length).toBeGreaterThan(0);
    expect(spectrogram?.rasterWidth).toBeGreaterThan(0);
    expect(spectrogram?.rasterHeight).toBeGreaterThan(0);
    expect(worker.postedTransferables[drawIndex]).toHaveLength(1);
    expect(worker.postedTransferables[drawIndex][0]).toBe(spectrogram?.values?.buffer);
  });
});
