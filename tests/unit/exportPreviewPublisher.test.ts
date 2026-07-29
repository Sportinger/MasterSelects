import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setExportPreviewFrame: vi.fn(),
  reportExportPreviewFrame: vi.fn(),
  canRetainExportPreviewFrame: vi.fn(() => ({ admitted: true })),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      isExporting: true,
      setExportPreviewFrame: mocks.setExportPreviewFrame,
    }),
  },
}));

vi.mock('../../src/services/timeline/exportRuntimeReporting', () => ({
  canRetainExportPreviewFrame: mocks.canRetainExportPreviewFrame,
  reportExportPreviewFrame: mocks.reportExportPreviewFrame,
}));

import { ExportPreviewPublisher } from '../../src/engine/export/frameExporter/ExportPreviewPublisher';

describe('ExportPreviewPublisher allocation bounds', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.setExportPreviewFrame.mockReset();
    mocks.reportExportPreviewFrame.mockReset();
    mocks.canRetainExportPreviewFrame.mockReset();
    mocks.canRetainExportPreviewFrame.mockReturnValue({ admitted: true });
  });

  it('allows only one asynchronous preview bitmap allocation at a time', async () => {
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const firstBitmapPromise = new Promise<ImageBitmap>(resolve => {
      resolveBitmap = resolve;
    });
    const bitmap = {
      width: 1920,
      height: 1080,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn(() => firstBitmapPromise);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const previewClone = { close: vi.fn() } as unknown as VideoFrame;
    const sourceFrame = {
      displayWidth: 1920,
      displayHeight: 1080,
      codedWidth: 1920,
      codedHeight: 1080,
      clone: vi.fn(() => previewClone),
    } as unknown as VideoFrame;
    const publisher = new ExportPreviewPublisher(0, () => 'run-1', vi.fn());

    publisher.publishFrame(sourceFrame, 1);
    publisher.publishFrame(sourceFrame, 2);

    expect(sourceFrame.clone).toHaveBeenCalledOnce();
    expect(createImageBitmapMock).toHaveBeenCalledOnce();

    resolveBitmap(bitmap);
    await firstBitmapPromise;
    await vi.waitFor(() => {
      expect(previewClone.close).toHaveBeenCalledOnce();
    });

    expect(mocks.setExportPreviewFrame).toHaveBeenCalledWith(bitmap, 1);
  });
});
