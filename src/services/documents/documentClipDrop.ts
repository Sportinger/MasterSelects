import { useDocumentsStore } from '../../stores/documentsStore';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { DocumentAnchor } from '../../types/documents';
import { notebookAnchorOffsets, notebookText } from './notebookRange';

export const DOCUMENT_PASSAGE_MIME = 'application/x-ms-document-passage';

export interface DocumentPassageDrag {
  documentId: string;
  documentRevision: number;
  anchor: DocumentAnchor;
}

export function parseDocumentPassageDrag(raw: string): DocumentPassageDrag | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<DocumentPassageDrag>;
    const anchor = candidate.anchor;
    if (typeof candidate.documentId !== 'string' || !Number.isSafeInteger(candidate.documentRevision)
      || !anchor || typeof anchor.blockId !== 'string'
      || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end)
      || typeof anchor.quote !== 'string' || anchor.status !== 'resolved'
      || (anchor.endBlockId !== undefined && typeof anchor.endBlockId !== 'string')
      || anchor.start < 0 || anchor.end < 0
      || (!anchor.endBlockId && anchor.end <= anchor.start)) return null;
    return candidate as DocumentPassageDrag;
  } catch { return null; }
}

/** Creates one clip-scoped annotation and its document reference in one undo step. */
export function linkDocumentPassageToClip(
  passage: DocumentPassageDrag,
  compositionId: string,
  clipId: string,
): boolean {
  const document = useDocumentsStore.getState().documents.find(item => item.id === passage.documentId);
  const offsets = document ? notebookAnchorOffsets(document.blocks, passage.anchor) : null;
  const media = useMediaStore.getState();
  const composition = media.compositions.find(item => item.id === compositionId);
  const clip = useTimelineStore.getState().clips.find(item => item.id === clipId);
  if (!document || !offsets || !composition || !clip || media.activeCompositionId !== compositionId
    || document.revision !== passage.documentRevision
    || !Number.isFinite(clip.duration) || clip.duration <= 0
    || offsets[0] === offsets[1]
    || notebookText(document.blocks).slice(...offsets) !== passage.anchor.quote) return false;

  const annotationId = crypto.randomUUID();
  const batch = startBatch('Link document passage to timeline clip');
  try {
    media.updateComposition(compositionId, { annotations: [...(composition.annotations ?? []), {
      id: annotationId,
      text: passage.anchor.quote,
      startTime: 0,
      endTime: clip.duration,
      createdAt: Date.now(),
      scope: 'clip',
      clipId,
    }] });
    useDocumentsStore.getState().addLink(document.id, passage.anchor,
      { kind: 'composition-annotation', compositionId, annotationId }, clip.name);
  } finally { if (batch.opened) endBatch(); }
  return true;
}
