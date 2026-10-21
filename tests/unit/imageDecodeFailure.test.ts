import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockFile = { id: string; decodeError?: string };
type MockMediaStore = {
  getState: () => { files: MockFile[] };
  setState: (state: { files: MockFile[] }) => void;
};

const mediaStoreMock = vi.hoisted(() => ({ store: null as unknown as MockMediaStore }));

vi.mock('../../src/stores/mediaStore', async () => {
  const { create: createStore } = await import('zustand');
  const store = createStore(() => ({ files: [] as MockFile[] }));
  mediaStoreMock.store = store;
  return { useMediaStore: store };
});

import { Logger } from '../../src/services/logger';
import {
  clearImageDecodeFailure,
  reportImageDecodeFailure,
  resetImageDecodeFailureReportsForTests,
} from '../../src/services/mediaRuntime/imageDecodeFailure';
import { getTimelineClipCanvasPassiveDecorationBadges } from '../../src/components/timeline/utils/timelineClipCanvasPassiveDecorations';
import { createTimelineClipCanvasMediaStatusMap } from '../../src/components/timeline/utils/timelineClipCanvasChromeOverlays';

function randomBytesJpeg(): File {
  const bytes = new Uint8Array([0x13, 0x37, 0x42, 0x99, 0x01, 0x02, 0x03, 0x04]);
  const file = new File([bytes], 'IMG_test.jpg', { type: 'image/jpeg' });
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Blob);
  return file;
}

const files = () => mediaStoreMock.store.getState().files;

describe('image decode failure reporting', () => {
  beforeEach(() => {
    resetImageDecodeFailureReportsForTests();
    mediaStoreMock.store.setState({ files: [{ id: 'media-1' }] });
  });

  it('warns once per broken image, marks the media item and shows a clip badge until it decodes', async () => {
    const before = Logger.getBuffer('WARN').length;
    const file = randomBytesJpeg();

    const message = await reportImageDecodeFailure({ name: file.name, file });
    await reportImageDecodeFailure({ name: file.name, file, mediaFileId: 'media-1' });
    await reportImageDecodeFailure({ name: file.name, file, mediaFileId: 'media-1' });

    expect(message).toMatch(/IMG_test\.jpg \(image\/jpeg, .*could not be decoded/);
    const decodeWarnings = Logger.getBuffer('WARN').slice(before).filter((entry) => entry.module === 'ImageDecode');
    expect(decodeWarnings).toHaveLength(1);
    expect(files()[0].decodeError).toBe(message);

    const status = createTimelineClipCanvasMediaStatusMap(files()).get('media-1');
    expect(getTimelineClipCanvasPassiveDecorationBadges({ duration: 5 }, status).map((badge) => badge.label)).toContain('BROKEN');

    clearImageDecodeFailure({ name: file.name, file, mediaFileId: 'media-1' });
    expect(files()[0].decodeError).toBeUndefined();
  });
});
