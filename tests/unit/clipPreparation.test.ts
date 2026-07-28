import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupExportMode,
  prepareClipsForExport,
  shouldAutoFallbackToPrecise,
  shouldUsePreciseForFastExportClipTopology,
  shouldUsePreciseForFastExportFileSizes,
} from '../../src/engine/export/ClipPreparation';
import type { ExportSettings } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { reportExportPreviewFrame } from '../../src/services/timeline/exportRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import { WebCodecsPlayer } from '../../src/engine/WebCodecsPlayer';

const initialMediaState = useMediaStore.getState();
const initialTimelineState = useTimelineStore.getState();

const exportSettings: ExportSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  container: 'mp4',
  bitrate: 8_000_000,
  startTime: 0,
  endTime: 5,
};

function makeTrack(): TimelineTrack {
  return {
    id: 'track-image',
    name: 'Video 1',
    type: 'video',
    visible: true,
    muted: false,
    solo: false,
  };
}

function makeImageClip(source: NonNullable<TimelineClip['source']>): TimelineClip {
  return {
    id: 'clip-image',
    trackId: 'track-image',
    name: 'Still.png',
    file: new File([], 'pending.png', { type: 'image/png' }),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source,
    mediaFileId: source.mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: false,
  };
}

function makeVideoClip(source: NonNullable<TimelineClip['source']>, file?: File): TimelineClip {
  return {
    id: 'clip-video',
    trackId: 'track-image',
    name: 'Video.mp4',
    file,
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source,
    mediaFileId: source.mediaFileId,
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: false,
  };
}

function installAutoLoadingImageMock(createdImages: HTMLImageElement[]): void {
  vi.stubGlobal('Image', vi.fn(function ImageMock() {
    const image = document.createElement('img');
    createdImages.push(image);
    queueMicrotask(() => image.dispatchEvent(new Event('load')));
    return image;
  }));
}

describe('ClipPreparation image export state', () => {
  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
    useTimelineStore.setState(initialTimelineState);
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    useTimelineStore.setState(initialTimelineState);
  });

  it('prepares data-only image clips from source imageUrl without mutating clip source', async () => {
    const createdImages: HTMLImageElement[] = [];
    installAutoLoadingImageMock(createdImages);
    const mediaFile = {
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      url: 'blob:media-image',
      duration: 5,
    } as MediaFile;
    const clip = makeImageClip({
      type: 'image',
      mediaFileId: mediaFile.id,
      naturalDuration: 5,
      imageUrl: 'blob:restored-image',
    });
    useTimelineStore.setState({
      tracks: [makeTrack()],
      clips: [clip],
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      files: [mediaFile],
    });

    const result = await prepareClipsForExport(exportSettings, 'precise');
    const state = result.clipStates.get(clip.id);

    expect(createdImages).toHaveLength(1);
    expect(createdImages[0].src).toBe('blob:restored-image');
    expect(state?.exportImageElement).toBe(createdImages[0]);
    expect(state?.exportImageObjectUrl).toBeNull();
    expect(clip.source?.imageElement).toBeUndefined();

    cleanupExportMode(result.clipStates, result.parallelDecoder);
  });

  it('revokes file-backed export image object urls during cleanup', async () => {
    const createdImages: HTMLImageElement[] = [];
    installAutoLoadingImageMock(createdImages);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export-image');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const mediaFile = {
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      file: new File(['image'], 'Still.png', { type: 'image/png' }),
      duration: 5,
    } as MediaFile;
    const clip = makeImageClip({
      type: 'image',
      mediaFileId: mediaFile.id,
      naturalDuration: 5,
    });
    useTimelineStore.setState({
      tracks: [makeTrack()],
      clips: [clip],
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      files: [mediaFile],
    });

    const result = await prepareClipsForExport(exportSettings, 'precise');

    expect(createObjectUrl).toHaveBeenCalledWith(mediaFile.file);
    expect(result.clipStates.get(clip.id)?.exportImageObjectUrl).toBe('blob:export-image');

    cleanupExportMode(result.clipStates, result.parallelDecoder);

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:export-image');
  });

  it('skips file-backed export image allocation when runtime admission is denied', async () => {
    const ImageCtor = vi.fn(function ImageMock() {
      return document.createElement('img');
    });
    vi.stubGlobal('Image', ImageCtor);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export-image');
    for (let index = 0; index < 128; index += 1) {
      reportExportPreviewFrame({
        runId: `existing-run-${index}`,
        width: 1,
        height: 1,
        currentTime: index,
      });
    }
    const mediaFile = {
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      file: new File(['image'], 'Still.png', { type: 'image/png' }),
      duration: 5,
    } as MediaFile;
    const clip = makeImageClip({
      type: 'image',
      mediaFileId: mediaFile.id,
      naturalDuration: 5,
    });
    useTimelineStore.setState({
      tracks: [makeTrack()],
      clips: [clip],
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      files: [mediaFile],
    });

    const result = await prepareClipsForExport(exportSettings, 'precise', 'denied-export-run');

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(ImageCtor).not.toHaveBeenCalled();
    expect(result.clipStates.get(clip.id)?.exportImageElement).toBeUndefined();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.budgetReport.usage.resources).toBe(128);
  });

  it('rejects FAST WebCodecs preparation before file reads when provider admission is denied', async () => {
    for (let index = 0; index < 128; index += 1) {
      reportExportPreviewFrame({
        runId: `existing-run-${index}`,
        width: 1,
        height: 1,
        currentTime: index,
      });
    }

    const file = new File(['video'], 'Video.mp4', { type: 'video/mp4' });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(16));
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: arrayBuffer,
    });
    const mediaFile = {
      id: 'media-video',
      name: 'Video.mp4',
      type: 'video',
      file,
      fileSize: file.size,
      width: 1920,
      height: 1080,
      duration: 5,
    } as MediaFile;
    const clip = makeVideoClip({
      type: 'video',
      mediaFileId: mediaFile.id,
      naturalDuration: 5,
    }, file);
    useTimelineStore.setState({
      tracks: [makeTrack()],
      clips: [clip],
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      files: [mediaFile],
    });

    await expect(prepareClipsForExport(exportSettings, 'fast', 'denied-fast-run')).rejects.toMatchObject({
      name: 'ExportPreparationAdmissionError',
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(timelineRuntimeCoordinator.getBridgeStats().policies.export.budgetReport.usage.resources).toBe(128);
  });

  it('falls back from FAST WebCodecs parse errors to PRECISE export preparation', async () => {
    const createdImages: HTMLImageElement[] = [];
    installAutoLoadingImageMock(createdImages);
    const originalCreateElement = document.createElement.bind(document);
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (
      blob instanceof File && blob.name === 'Still.png'
        ? 'blob:export-image'
        : 'blob:precise-video'
    ));
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const fastPlayer = {
      loadArrayBuffer: vi.fn(async () => {
        throw new Error('MP4 parsing error: ISOFile');
      }),
      destroy: vi.fn(),
    };
    vi.mocked(WebCodecsPlayer).mockImplementation(function WebCodecsPlayerMock() {
      return fastPlayer as unknown as WebCodecsPlayer;
    });
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'video') {
        Object.defineProperties(element, {
          readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
          duration: { configurable: true, value: 5 },
          seeking: { configurable: true, value: false },
          currentTime: { configurable: true, writable: true, value: 0 },
          load: { configurable: true, value: vi.fn() },
          pause: { configurable: true, value: vi.fn() },
        });
      }
      return element;
    }) as typeof document.createElement);
    const file = new File(['not mp4'], 'Video.webm', { type: 'video/webm' });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(16));
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: arrayBuffer,
    });
    const mediaFile = {
      id: 'media-video',
      name: 'Video.webm',
      type: 'video',
      file,
      fileSize: file.size,
      width: 1920,
      height: 1080,
      duration: 5,
    } as MediaFile;
    const imageFile = new File(['image'], 'Still.png', { type: 'image/png' });
    const imageMediaFile = {
      id: 'media-image',
      name: 'Still.png',
      type: 'image',
      file: imageFile,
      duration: 5,
    } as MediaFile;
    const imageClip = makeImageClip({
      type: 'image',
      mediaFileId: imageMediaFile.id,
      naturalDuration: 5,
    });
    const clip = makeVideoClip({
      type: 'video',
      mediaFileId: mediaFile.id,
      naturalDuration: 5,
    }, file);
    useTimelineStore.setState({
      tracks: [makeTrack()],
      clips: [imageClip, clip],
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      files: [imageMediaFile, mediaFile],
    });

    const result = await prepareClipsForExport(exportSettings, 'fast', 'fallback-fast-run');

    expect(result.exportMode).toBe('precise');
    expect(result.useParallelDecode).toBe(false);
    expect(result.parallelDecoder).toBeNull();
    expect(result.clipStates.get(clip.id)).toMatchObject({
      clipId: clip.id,
      webCodecsPlayer: null,
      isSequential: false,
      preciseVideoObjectUrl: 'blob:precise-video',
      hasDedicatedPreciseVideoElement: true,
    });
    expect(result.clipStates.get(imageClip.id)).toMatchObject({
      exportImageObjectUrl: 'blob:export-image',
    });
    expect(createdImages.length).toBeGreaterThanOrEqual(2);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(fastPlayer.loadArrayBuffer).toHaveBeenCalledTimes(1);
    expect(fastPlayer.destroy).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(file);
    expect(createObjectUrl).toHaveBeenCalledWith(imageFile);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:export-image');

    cleanupExportMode(result.clipStates, result.parallelDecoder);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:precise-video');
  });

  it('routes large FAST WebCodecs source sets to PRECISE preparation', () => {
    expect(shouldUsePreciseForFastExportFileSizes({
      totalBytes: 1024 * 1024 * 1024,
      largestBytes: 512 * 1024 * 1024,
      largestClipName: 'Small.mp4',
      uniqueSourceCount: 1,
    })).toBe(false);

    expect(shouldUsePreciseForFastExportFileSizes({
      totalBytes: 1600 * 1024 * 1024,
      largestBytes: 1536 * 1024 * 1024,
      largestClipName: 'Large.mp4',
      uniqueSourceCount: 1,
    })).toBe(true);

    expect(shouldUsePreciseForFastExportFileSizes({
      totalBytes: 2048 * 1024 * 1024,
      largestBytes: 800 * 1024 * 1024,
      largestClipName: 'Part.mp4',
      uniqueSourceCount: 3,
    })).toBe(true);
  });

  it('counts shareable sources instead of raw clip count for FAST topology', () => {
    const source: NonNullable<TimelineClip['source']> = {
      type: 'video',
      mediaFileId: 'media-video',
      naturalDuration: 5,
    };
    const clips = Array.from({ length: 9 }, (_, index) => ({
      ...makeVideoClip(source),
      id: `clip-video-${index}`,
      startTime: index * 0.4,
      duration: 0.4,
      inPoint: index * 0.4,
      outPoint: (index + 1) * 0.4,
    }));

    expect(shouldUsePreciseForFastExportClipTopology(clips.slice(0, 8))).toBe(false);
    expect(shouldUsePreciseForFastExportClipTopology(clips)).toBe(false);

    const distinctSourceClips = clips.map((clip, index) => ({
      ...clip,
      mediaFileId: `media-video-${index}`,
      source: {
        ...clip.source!,
        mediaFileId: `media-video-${index}`,
      },
    }));
    expect(shouldUsePreciseForFastExportClipTopology(distinctSourceClips)).toBe(true);

    const overlappingSameSourceClips = clips.map(clip => ({
      ...clip,
      startTime: 0,
    }));
    expect(shouldUsePreciseForFastExportClipTopology(overlappingSameSourceClips)).toBe(true);
  });

  it('prepares dense same-source FAST cut-ups with one shared decoder', async () => {
    const originalCreateElement = document.createElement.bind(document);
    const sharedVideo = originalCreateElement('video');
    const fastPlayer = {
      loadArrayBuffer: vi.fn(async () => undefined),
      prepareForSequentialExport: vi.fn(async () => undefined),
      getCurrentSampleIndex: vi.fn(() => 0),
      endSequentialExport: vi.fn(),
      destroy: vi.fn(),
      width: 1920,
      height: 1080,
    };
    vi.mocked(WebCodecsPlayer).mockImplementation(function WebCodecsPlayerMock() {
      return fastPlayer as unknown as WebCodecsPlayer;
    });

    const file = new File(['video'], 'Video.mp4', { type: 'video/mp4' });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(16));
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: arrayBuffer,
    });
    const mediaFile = {
      id: 'media-video',
      name: 'Video.mp4',
      type: 'video',
      file,
      fileSize: file.size,
      width: 1920,
      height: 1080,
      duration: 5,
    } as MediaFile;
    const source: NonNullable<TimelineClip['source']> = {
      type: 'video',
      mediaFileId: mediaFile.id,
      naturalDuration: 5,
      videoElement: sharedVideo,
    };
    const clips = Array.from({ length: 49 }, (_, index) => ({
      ...makeVideoClip(source, file),
      id: `clip-video-${index}`,
      startTime: index * 0.1,
      duration: 0.1,
      inPoint: index * 0.1,
      outPoint: (index + 1) * 0.1,
    }));
    useTimelineStore.setState({
      tracks: [makeTrack()],
      clips,
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      files: [mediaFile],
    });

    const result = await prepareClipsForExport(exportSettings, 'fast', 'dense-cut-up-run');

    expect(result.exportMode).toBe('fast');
    expect(result.clipStates.size).toBe(49);
    expect(Array.from(result.clipStates.values()).every(state =>
      state.webCodecsPlayer === fastPlayer &&
      state.isSequential === true
    )).toBe(true);
    expect(new Set(Array.from(result.clipStates.values()).map(
      state => state.webCodecsPlayer
    )).size).toBe(1);
    expect(WebCodecsPlayer).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(fastPlayer.loadArrayBuffer).toHaveBeenCalledTimes(1);
    expect(fastPlayer.prepareForSequentialExport).toHaveBeenCalledTimes(1);

    cleanupExportMode(result.clipStates, result.parallelDecoder);

    expect(fastPlayer.endSequentialExport).toHaveBeenCalledTimes(1);
    expect(fastPlayer.destroy).toHaveBeenCalledTimes(1);
  });

  it('falls back from closed or failed WebCodecs decoder states', () => {
    expect(shouldAutoFallbackToPrecise(
      new DOMException(
        "Failed to execute 'decode' on 'VideoDecoder': Cannot call 'decode' on a closed codec.",
        'InvalidStateError'
      )
    )).toBe(true);
    expect(shouldAutoFallbackToPrecise(
      new DOMException('Decoding error.', 'EncodingError')
    )).toBe(true);
    expect(shouldAutoFallbackToPrecise(
      new Error('FAST export decoder closed during decodeSampleWindow')
    )).toBe(true);
    expect(shouldAutoFallbackToPrecise(new Error('Unrelated export failure'))).toBe(false);
  });
});
