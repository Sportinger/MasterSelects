import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore';
import { parseDocumentMediaDrag, resolveDocumentMediaDrag } from '../../src/services/documents/documentMediaDrag';

const source = {
  id: 'source-1', name: 'take.mp4', type: 'video', duration: 12,
  parentId: null, createdAt: 1,
  sourceAnnotations: [{ id: 'annotation-1', text: 'Best take', startTime: 3,
    endTime: 5, createdAt: 1 }],
} as MediaFile;

describe('document media reference drag', () => {
  it('carries the referenced source window, including annotation ranges', () => {
    expect(resolveDocumentMediaDrag({ kind: 'source', mediaId: source.id, start: 2, end: 6 }, [source]))
      .toEqual({ mediaId: source.id, start: 2, end: 6 });
    expect(resolveDocumentMediaDrag({ kind: 'source-annotation', mediaId: source.id,
      annotationId: 'annotation-1' }, [source]))
      .toEqual({ mediaId: source.id, start: 3, end: 5 });
    expect(resolveDocumentMediaDrag({ kind: 'source', mediaId: source.id }, [source]))
      .toEqual({ mediaId: source.id });
  });

  it('rejects stale, unknown-length, and mismatched references', () => {
    expect(resolveDocumentMediaDrag({ kind: 'source', mediaId: source.id, start: 11, end: 14 }, [source]))
      .toBeNull();
    expect(resolveDocumentMediaDrag({ kind: 'source', mediaId: source.id, start: 3 },
      [{ ...source, duration: undefined }])).toBeNull();
    expect(resolveDocumentMediaDrag({ kind: 'source-annotation', mediaId: source.id,
      annotationId: 'missing' }, [source])).toBeNull();
    expect(parseDocumentMediaDrag(JSON.stringify({ mediaId: source.id, start: 2, end: 6 }), source.id))
      .toEqual({ mediaId: source.id, start: 2, end: 6 });
    expect(parseDocumentMediaDrag(JSON.stringify({ mediaId: source.id, start: 2, end: 6 }), 'other'))
      .toBeNull();
    expect(parseDocumentMediaDrag(JSON.stringify({ mediaId: source.id, start: 9, end: 4 }), source.id))
      .toBeNull();
  });
});
