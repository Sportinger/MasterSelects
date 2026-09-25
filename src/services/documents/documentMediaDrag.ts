import type { MediaFile } from '../../stores/mediaStore';
import type { DocumentLinkTarget } from '../../types/documents';

export const DOCUMENT_MEDIA_REFERENCE_MIME = 'application/x-ms-document-media-reference';

export interface DocumentMediaDrag {
  mediaId: string;
  start?: number;
  end?: number;
}

export function resolveDocumentMediaDrag(target: DocumentLinkTarget,
  files: MediaFile[]): DocumentMediaDrag | null {
  if (target.kind !== 'source' && target.kind !== 'source-annotation') return null;
  const media = files.find(item => item.id === target.mediaId);
  if (!media || !['video', 'audio', 'image'].includes(media.type)) return null;
  const annotation = target.kind === 'source-annotation'
    ? media.sourceAnnotations?.find(item => item.id === target.annotationId) : undefined;
  if (target.kind === 'source-annotation' && !annotation) return null;
  const start = target.kind === 'source' ? target.start : annotation?.startTime;
  const end = target.kind === 'source' ? target.end : annotation?.endTime;
  if (start === undefined && end === undefined) return { mediaId: media.id };
  if (!Number.isFinite(media.duration)) return null;
  const resolvedStart = start ?? 0;
  const resolvedEnd = end ?? media.duration;
  if (!Number.isFinite(resolvedStart) || !Number.isFinite(resolvedEnd)
    || resolvedEnd === undefined || resolvedStart < 0 || resolvedEnd <= resolvedStart
    || (media.duration !== undefined && resolvedEnd > media.duration + 0.001)) return null;
  return { mediaId: media.id, start: resolvedStart, end: resolvedEnd };
}

export function parseDocumentMediaDrag(raw: string, mediaId: string): DocumentMediaDrag | null {
  try {
    const value = JSON.parse(raw) as Partial<DocumentMediaDrag>;
    if (value.mediaId !== mediaId || !mediaId) return null;
    if (value.start === undefined && value.end === undefined) return { mediaId };
    if (!Number.isFinite(value.start) || !Number.isFinite(value.end)
      || value.start! < 0 || value.end! <= value.start!) return null;
    return { mediaId, start: value.start, end: value.end };
  } catch { return null; }
}
