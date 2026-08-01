import { afterEach, describe, expect, it } from 'vitest';

import {
  EXPORT_MEDIA_IDS_MIME_TYPE,
  applyExportMediaIdsToDataTransfer,
  clearExternalDragPayload,
  clearExportMediaDragIds,
  getExportMediaDragIds,
  parseExportMediaIds,
  readExportMediaIdsFromDataTransfer,
  serializeExportMediaIds,
} from '../../src/components/timeline/utils/externalDragSession';

describe('batch export media drag payload', () => {
  afterEach(() => {
    clearExportMediaDragIds();
  });

  it('parses safely and de-duplicates valid IDs', () => {
    expect(parseExportMediaIds('["video-1"," audio-1 ","video-1",4,null,""]'))
      .toEqual(['video-1', 'audio-1']);
    expect(parseExportMediaIds('{"id":"video-1"}')).toEqual([]);
    expect(parseExportMediaIds('not-json')).toEqual([]);
    expect(parseExportMediaIds(undefined)).toEqual([]);
    expect(serializeExportMediaIds(['video-1', 'video-1', 'audio-1']))
      .toBe('["video-1","audio-1"]');
  });

  it('writes the stable MIME payload and reads it before the session fallback', () => {
    const transferred = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => transferred.set(type, value),
      getData: (type: string) => transferred.get(type) ?? '',
    };

    applyExportMediaIdsToDataTransfer(dataTransfer, ['video-1', 'audio-1']);
    expect(transferred.get(EXPORT_MEDIA_IDS_MIME_TYPE)).toBe('["video-1","audio-1"]');
    expect(getExportMediaDragIds()).toEqual(['video-1', 'audio-1']);

    transferred.set(EXPORT_MEDIA_IDS_MIME_TYPE, '["image-1"]');
    expect(readExportMediaIdsFromDataTransfer(dataTransfer)).toEqual(['image-1']);
  });

  it('falls back to a defensive copy of the same-document session', () => {
    const dataTransfer = {
      setData: () => undefined,
      getData: () => {
        throw new Error('custom data unavailable');
      },
    };

    applyExportMediaIdsToDataTransfer(dataTransfer, ['video-1', 'video-1']);
    const fallbackIds = readExportMediaIdsFromDataTransfer(dataTransfer);
    fallbackIds.push('mutated');

    expect(fallbackIds).toEqual(['video-1', 'mutated']);
    expect(getExportMediaDragIds()).toEqual(['video-1']);

    clearExternalDragPayload();
    expect(readExportMediaIdsFromDataTransfer(dataTransfer)).toEqual([]);
  });
});
