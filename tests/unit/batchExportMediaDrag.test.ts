import { describe, expect, it } from 'vitest';

import { planBatchExportMediaDragIds } from '../../src/components/panels/media/panel/batchExportMediaDrag';
import type { MediaFile, ProjectItem } from '../../src/stores/mediaStore';

const needsRelink = (media: MediaFile) => !media.file && !media.absolutePath;

function mediaFile(
  id: string,
  type: MediaFile['type'] = 'video',
  overrides: Partial<MediaFile> = {},
): MediaFile {
  return {
    id,
    name: `${id}.${type}`,
    type,
    parentId: null,
    createdAt: 1,
    file: new File(['media'], `${id}.${type}`),
    url: `blob:${id}`,
    ...overrides,
  };
}

describe('batch export media drag planning', () => {
  it('uses selected eligible media in selection order and de-duplicates IDs', () => {
    const video = mediaFile('video-1', 'video');
    const audio = mediaFile('audio-1', 'audio');
    const image = mediaFile('image-1', 'image');
    const model = mediaFile('model-1', 'model');
    const importing = mediaFile('importing-1', 'video', { isImporting: true });
    const missing = mediaFile('missing-1', 'audio', { file: undefined });

    expect(planBatchExportMediaDragIds(
      video,
      ['image-1', 'video-1', 'image-1', 'model-1', 'importing-1', 'missing-1', 'audio-1'],
      [video, audio, image, model, importing, missing],
      needsRelink,
    )).toEqual(['image-1', 'video-1', 'audio-1']);
  });

  it('uses only the dragged file when it is outside the selection', () => {
    const video = mediaFile('video-1');
    const audio = mediaFile('audio-1', 'audio');

    expect(planBatchExportMediaDragIds(video, ['audio-1'], [video, audio], needsRelink)).toEqual(['video-1']);
  });

  it('rejects non-exportable dragged project items', () => {
    const composition: ProjectItem = {
      id: 'comp-1',
      name: 'Composition',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 5,
    };
    const liveVideo = mediaFile('live-1', 'video', {
      file: undefined,
      liveInput: { kind: 'display' },
    });

    expect(planBatchExportMediaDragIds(composition, ['comp-1'], [], needsRelink)).toEqual([]);
    expect(planBatchExportMediaDragIds(liveVideo, ['live-1'], [liveVideo], needsRelink)).toEqual([]);
  });
});
