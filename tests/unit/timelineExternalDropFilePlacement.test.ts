import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/timeline/timelineExternalDropMediaResolver', () => ({
  getTimelineDropMediaTypeOverride: vi.fn(),
  resolveTimelineDropImportResult: vi.fn(),
  resolveTimelineDropMediaFile: vi.fn(),
  setTimelineDroppedFilePath: vi.fn(),
}));

vi.mock('../../src/runtime/renderers/signalTimelineRendererAdapter', () => ({
  createSignalTimelineAdapterPlan: vi.fn(),
}));

import {
  getTimelineDropMediaTypeOverride,
  resolveTimelineDropImportResult,
  resolveTimelineDropMediaFile,
  setTimelineDroppedFilePath,
} from '../../src/services/timeline/timelineExternalDropMediaResolver';
import { createSignalTimelineAdapterPlan } from '../../src/runtime/renderers/signalTimelineRendererAdapter';
import { placeTimelineExternalDropFiles } from '../../src/services/timeline/timelineExternalDropFilePlacement';
import type { MediaFile, SignalAssetItem } from '../../src/stores/mediaStore';

const getTimelineDropMediaTypeOverrideMock = vi.mocked(getTimelineDropMediaTypeOverride);
const resolveTimelineDropImportResultMock = vi.mocked(resolveTimelineDropImportResult);
const resolveTimelineDropMediaFileMock = vi.mocked(resolveTimelineDropMediaFile);
const setTimelineDroppedFilePathMock = vi.mocked(setTimelineDroppedFilePath);
const createSignalTimelineAdapterPlanMock = vi.mocked(createSignalTimelineAdapterPlan);

function mediaFile(overrides: Partial<MediaFile>): MediaFile {
  return {
    id: 'media-1',
    name: 'media.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    ...overrides,
  } as MediaFile;
}

function signalAsset(overrides: Partial<SignalAssetItem>): SignalAssetItem {
  return {
    id: 'signal-1',
    name: 'signal.csv',
    type: 'signal',
    parentId: null,
    createdAt: 1,
    asset: {} as SignalAssetItem['asset'],
    artifacts: [],
    signalKinds: [],
    ...overrides,
  } as SignalAssetItem;
}

describe('timeline external drop file placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTimelineDropMediaTypeOverrideMock.mockReturnValue(undefined);
    resolveTimelineDropImportResultMock.mockResolvedValue(null);
    resolveTimelineDropMediaFileMock.mockImplementation(async ({ file }) =>
      mediaFile({
        id: `media-${file.name}`,
        name: file.name,
        type: file.type.startsWith('audio/') ? 'audio' : 'video',
        file,
        duration: file.name.includes('second') ? 3 : 4,
      })
    );
    createSignalTimelineAdapterPlanMock.mockReturnValue(
      { duration: 6 } as ReturnType<typeof createSignalTimelineAdapterPlan>,
    );
  });

  it('places supported dropped files sequentially through injected clip actions', async () => {
    const addClip = vi.fn().mockResolvedValue('clip-first');
    const addSignalAssetClip = vi.fn();
    const firstFile = new File(['video'], 'first.mp4', { type: 'video/mp4' });
    const secondFile = new File(['video'], 'second.mp4', { type: 'video/mp4' });

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip, addSignalAssetClip },
      records: [
        { file: firstFile, absolutePath: 'C:/media/first.mp4' },
        { file: secondFile, absolutePath: 'C:/media/second.mp4' },
      ],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 2,
    });

    expect(placed).toBe(true);
    expect(setTimelineDroppedFilePathMock).toHaveBeenCalledWith(firstFile, 'C:/media/first.mp4');
    expect(setTimelineDroppedFilePathMock).toHaveBeenCalledWith(secondFile, 'C:/media/second.mp4');
    expect(resolveTimelineDropMediaFileMock).toHaveBeenNthCalledWith(1, {
      file: firstFile,
      handle: undefined,
      absolutePath: 'C:/media/first.mp4',
    });
    expect(resolveTimelineDropMediaFileMock).toHaveBeenNthCalledWith(2, {
      file: secondFile,
      handle: undefined,
      absolutePath: 'C:/media/second.mp4',
    });
    expect(resolveTimelineDropImportResultMock).not.toHaveBeenCalled();
    expect(addClip).toHaveBeenNthCalledWith(
      1,
      'video-1',
      firstFile,
      2,
      4,
      'media-first.mp4',
      'video',
    );
    expect(addClip).toHaveBeenNthCalledWith(
      2,
      'video-1',
      secondFile,
      6,
      3,
      'media-second.mp4',
      'video',
    );
    expect(addSignalAssetClip).not.toHaveBeenCalled();
  });

  it('skips files that do not match the target track kind before importing media', async () => {
    const addClip = vi.fn();
    const addSignalAssetClip = vi.fn();
    const audioFile = new File(['audio'], 'dialog.wav', { type: 'audio/wav' });

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip, addSignalAssetClip },
      records: [{ file: audioFile }],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 0,
    });

    expect(placed).toBe(false);
    expect(resolveTimelineDropMediaFileMock).not.toHaveBeenCalled();
    expect(resolveTimelineDropImportResultMock).not.toHaveBeenCalled();
    expect(addClip).not.toHaveBeenCalled();
    expect(addSignalAssetClip).not.toHaveBeenCalled();
  });

  it('uses source-specific media type overrides after media resolution', async () => {
    const addClip = vi.fn().mockResolvedValue('clip-model');
    const addSignalAssetClip = vi.fn();
    const modelFile = new File(['model'], 'hero.glb', { type: 'model/gltf-binary' });
    getTimelineDropMediaTypeOverrideMock.mockReturnValue('model');
    resolveTimelineDropMediaFileMock.mockResolvedValue(mediaFile({
      id: 'model-1',
      name: 'hero.glb',
      type: 'model',
      file: modelFile,
      duration: 9,
    }));

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip, addSignalAssetClip },
      records: [{ file: modelFile }],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 5,
      fallbackDuration: 8,
      resolveStartTime: (desiredStartTime, duration) => desiredStartTime + (duration ?? 0),
    });

    expect(placed).toBe(true);
    expect(addClip).toHaveBeenCalledWith(
      'video-1',
      modelFile,
      13,
      9,
      'model-1',
      'model',
    );
    expect(addSignalAssetClip).not.toHaveBeenCalled();
  });

  it('imports unknown dropped files as signal assets and places them on video tracks', async () => {
    const addClip = vi.fn();
    const addSignalAssetClip = vi.fn().mockResolvedValue('signal-clip-1');
    const csvFile = new File(['name,value\nalpha,1'], 'data.csv', { type: 'text/csv' });
    const importedSignal = signalAsset({
      id: 'signal-csv-1',
      name: 'data.csv',
      fileSize: csvFile.size,
    });
    const handle = {} as FileSystemFileHandle;
    resolveTimelineDropImportResultMock.mockResolvedValue({
      kind: 'signal-asset',
      signalAsset: importedSignal,
    });
    createSignalTimelineAdapterPlanMock.mockReturnValue(
      { duration: 7 } as ReturnType<typeof createSignalTimelineAdapterPlan>,
    );

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip, addSignalAssetClip },
      records: [{ file: csvFile, handle, absolutePath: 'C:/media/data.csv' }],
      trackId: 'video-1',
      trackIsVideo: true,
      baseStartTime: 3,
      resolveStartTime: (desiredStartTime, duration) => desiredStartTime + (duration ?? 0),
    });

    expect(placed).toBe(true);
    expect(resolveTimelineDropMediaFileMock).not.toHaveBeenCalled();
    expect(resolveTimelineDropImportResultMock).toHaveBeenCalledWith({
      file: csvFile,
      handle,
      absolutePath: 'C:/media/data.csv',
      waitForMediaPlaceholder: false,
    });
    expect(addClip).not.toHaveBeenCalled();
    expect(addSignalAssetClip).toHaveBeenCalledWith('video-1', importedSignal, 10);
  });

  it('skips unknown files on audio tracks before importing signals', async () => {
    const addClip = vi.fn();
    const addSignalAssetClip = vi.fn();
    const csvFile = new File(['name,value\nalpha,1'], 'data.csv', { type: 'text/csv' });

    const placed = await placeTimelineExternalDropFiles({
      actions: { addClip, addSignalAssetClip },
      records: [{ file: csvFile }],
      trackId: 'audio-1',
      trackIsVideo: false,
      baseStartTime: 0,
    });

    expect(placed).toBe(false);
    expect(resolveTimelineDropMediaFileMock).not.toHaveBeenCalled();
    expect(resolveTimelineDropImportResultMock).not.toHaveBeenCalled();
    expect(addClip).not.toHaveBeenCalled();
    expect(addSignalAssetClip).not.toHaveBeenCalled();
  });
});
