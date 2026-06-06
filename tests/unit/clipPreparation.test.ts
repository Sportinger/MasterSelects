import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupExportMode, prepareClipsForExport } from '../../src/engine/export/ClipPreparation';
import type { ExportSettings } from '../../src/engine/export/types';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { reportExportPreviewFrame } from '../../src/services/timeline/exportRuntimeReporting';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

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
});
