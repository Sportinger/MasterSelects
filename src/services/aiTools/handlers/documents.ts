import { useDocumentsStore } from '../../../stores/documentsStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { paginateScreenplay } from '../../documents/screenplayLayout';
import { notebookAnchorOffsets, notebookOffset } from '../../documents/notebookRange';
import type { DocumentAnchor, DocumentLinkTarget, ProjectDocument } from '../../../types/documents';
import type { ToolResult } from '../types';

const fail = (error: string): ToolResult => ({ success: false, error });
const success = (data: unknown): ToolResult => ({ success: true, data });
const textArg = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function documentById(id: unknown): ProjectDocument | null {
  if (!textArg(id)) return null;
  return useDocumentsStore.getState().documents.find(document => document.id === id) ?? null;
}

function currentRevision(args: Record<string, unknown>): ProjectDocument | ToolResult {
  const document = documentById(args.documentId);
  if (!document) return fail('Document not found.');
  if (args.expectedRevision !== document.revision) return fail(`Document revision conflict: current revision is ${document.revision}.`);
  return document;
}

function isFailure(value: ProjectDocument | ToolResult): value is ToolResult {
  return 'success' in value;
}

function runMutation(label: string, action: () => unknown): ToolResult {
  const batch = startBatch(label);
  try { return success(action()); } finally { if (batch.opened) endBatch(); }
}

function anchorFor(document: ProjectDocument, args: Record<string, unknown>): DocumentAnchor | ToolResult {
  const block = document.blocks.find(item => item.id === args.blockId);
  if (!block) return fail('Document block not found.');
  const { start, end } = args;
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || (start as number) < 0 || (end as number) < (start as number) || (end as number) > block.text.length) {
    return fail('Text range is outside the block.');
  }
  return { blockId: block.id, start: start as number, end: end as number,
    quote: block.text.slice(start as number, end as number), status: 'resolved' };
}

function targetFor(args: Record<string, unknown>): DocumentLinkTarget | ToolResult {
  const media = useMediaStore.getState();
  const timeline = useTimelineStore.getState();
  const mediaId = args.mediaId;
  const compositionId = args.compositionId;
  const clipId = args.clipId;
  const annotationId = args.annotationId;
  const range = args.targetStart === undefined && args.targetEnd === undefined ? {} : {
    start: args.targetStart, end: args.targetEnd,
  };
  if (Object.values(range).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    || (typeof range.start === 'number' && typeof range.end === 'number' && range.end < range.start)) {
    return fail('Target range must contain finite, ordered seconds.');
  }
  if (args.targetKind === 'source' && textArg(mediaId) && media.files.some(item => item.id === mediaId)) {
    return { kind: 'source', mediaId, ...range } as DocumentLinkTarget;
  }
  if (args.targetKind === 'clip' && textArg(compositionId) && textArg(clipId)
    && media.compositions.some(item => item.id === compositionId)
    && (media.activeCompositionId === compositionId ? timeline.clips.some(item => item.id === clipId)
      : media.compositions.find(item => item.id === compositionId)?.timelineData?.clips.some(item => item.id === clipId))) {
    return { kind: 'clip', compositionId, clipId, ...range } as DocumentLinkTarget;
  }
  if (args.targetKind === 'composition' && textArg(compositionId)
    && typeof range.start === 'number' && typeof range.end === 'number'
    && media.compositions.some(item => item.id === compositionId)) {
    return { kind: 'composition', compositionId, start: range.start, end: range.end };
  }
  if (args.targetKind === 'source-annotation' && textArg(mediaId) && textArg(annotationId)
    && media.files.find(item => item.id === mediaId)?.sourceAnnotations?.some(item => item.id === annotationId)) {
    return { kind: 'source-annotation', mediaId, annotationId };
  }
  if (args.targetKind === 'composition-annotation' && textArg(compositionId) && textArg(annotationId)
    && media.compositions.find(item => item.id === compositionId)?.annotations?.some(item => item.id === annotationId)) {
    return { kind: 'composition-annotation', compositionId, annotationId };
  }
  return fail('The referenced media, clip, composition or annotation target does not exist.');
}

function touchesBlock(document: ProjectDocument, anchor: DocumentAnchor, blockId: string): boolean {
  const range = notebookAnchorOffsets(document.blocks, anchor);
  const start = notebookOffset(document.blocks, { blockId, offset: 0 });
  const block = document.blocks.find(item => item.id === blockId);
  if (!range || start === null || !block) return false;
  const end = start + block.text.length;
  return range[0] === range[1]
    ? range[0] >= start && range[0] <= end
    : range[0] < end && range[1] > start;
}

export async function handleListDocuments(): Promise<ToolResult> {
  return success(useDocumentsStore.getState().documents.map(document => ({
    id: document.id, title: document.title.trim() || document.blocks.map(block => block.text.trim())
      .find(Boolean)?.slice(0, 60) || 'Untitled note', kind: document.kind, revision: document.revision,
    sourceFormat: document.source?.format, sourcePages: document.source?.pageCount,
    productionPages: document.kind === 'screenplay' ? paginateScreenplay(document).length : undefined,
  })));
}

export async function handleSearchDocuments(args: Record<string, unknown>): Promise<ToolResult> {
  if (!textArg(args.query)) return fail('query is required.');
  const query = args.query.toLowerCase();
  const docs = useDocumentsStore.getState().documents.filter(document => !args.documentId || document.id === args.documentId);
  const matches = docs.flatMap(document => document.blocks.flatMap(block => {
    const start = block.text.toLowerCase().indexOf(query);
    return start < 0 ? [] : [{ documentId: document.id, revision: document.revision,
      blockId: block.id, sourcePage: block.sourcePage, anchor: { start, end: start + query.length },
      excerpt: block.text.slice(Math.max(0, start - 80), Math.min(block.text.length, start + query.length + 80)) }];
  }));
  return success({ matches: matches.slice(0, 50), hasMore: matches.length > 50 });
}

export async function handleReadDocument(args: Record<string, unknown>): Promise<ToolResult> {
  const document = documentById(args.documentId);
  if (!document) return fail('Document not found.');
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(40, Math.floor(args.limit))) : 20;
  let blocks = document.blocks;
  let pageType: string | undefined;
  if (args.productionPage !== undefined) {
    if (!textArg(args.productionPage) || document.kind !== 'screenplay') return fail('Production page requires a screenplay.');
    const page = paginateScreenplay(document).find(item => item.label === args.productionPage);
    if (!page) return fail('Production page not found.');
    const ids = new Set(page.lines.map(line => line.blockId));
    blocks = blocks.filter(block => ids.has(block.id));
    pageType = 'production';
  } else if (args.sourcePage !== undefined) {
    if (!Number.isInteger(args.sourcePage) || (args.sourcePage as number) < 1) return fail('Source page must be a positive integer.');
    blocks = blocks.filter(block => block.sourcePage === args.sourcePage);
    pageType = 'source';
  } else if (args.blockId !== undefined) {
    const index = blocks.findIndex(block => block.id === args.blockId);
    if (index < 0) return fail('Document block not found.');
    blocks = blocks.slice(index);
  }
  const selected = blocks.slice(0, limit);
  return success({ documentId: document.id, title: document.title, revision: document.revision,
    schemaVersion: document.schemaVersion,
    pageType, page: args.productionPage ?? args.sourcePage,
    blocks: selected.map(block => ({ ...block,
      anchor: { blockId: block.id, start: 0, end: block.text.length },
      links: document.links.filter(link => touchesBlock(document, link.anchor, block.id)).slice(0, 20),
      labels: document.labels?.filter(label => touchesBlock(document, label.anchor, block.id)).slice(0, 20) ?? [],
      scenes: document.scenes?.filter(scene => touchesBlock(document, scene.anchor, block.id)).slice(0, 20) ?? [],
      formats: document.formats?.filter(format => touchesBlock(document, format.anchor, block.id)).slice(0, 20) ?? [],
    })), hasMore: blocks.length > limit, nextBlockId: blocks[limit]?.id });
}

export async function handleGetDocumentLinks(args: Record<string, unknown>): Promise<ToolResult> {
  const document = documentById(args.documentId);
  if (!document || !textArg(args.blockId)) return fail('Document and block IDs are required.');
  return success({ documentId: document.id, revision: document.revision,
    links: document.links.filter(link => touchesBlock(document, link.anchor, args.blockId as string)).slice(0, 100) });
}

export async function handleCreateProjectDocument(args: Record<string, unknown>): Promise<ToolResult> {
  if (!textArg(args.title) || !['general', 'screenplay'].includes(String(args.kind))) return fail('Valid title and kind are required.');
  return runMutation('Create document', () => ({ documentId: useDocumentsStore.getState()
    .createDocument(args.title as string, args.kind as 'general' | 'screenplay') }));
}

export async function handleEditDocumentBlock(args: Record<string, unknown>): Promise<ToolResult> {
  const document = currentRevision(args);
  if (isFailure(document)) return document;
  if (!textArg(args.blockId) || typeof args.text !== 'string' || args.text.length > 100_000) return fail('Valid block ID and text are required.');
  if (!document.blocks.some(block => block.id === args.blockId)) return fail('Document block not found.');
  return runMutation('Edit document block', () => {
    useDocumentsStore.getState().updateBlock(document.id, args.blockId as string, args.text as string);
    return { documentId: document.id, revision: useDocumentsStore.getState().documents.find(item => item.id === document.id)?.revision };
  });
}

export async function handleAddDocumentComment(args: Record<string, unknown>): Promise<ToolResult> {
  const document = currentRevision(args);
  if (isFailure(document)) return document;
  const anchor = anchorFor(document, args);
  if ('success' in anchor) return anchor;
  if (!textArg(args.text)) return fail('Comment text is required.');
  return runMutation('Add document comment', () => ({ commentId: useDocumentsStore.getState()
    .addComment(document.id, anchor, args.text as string) }));
}

export async function handleAddDocumentMediaLink(args: Record<string, unknown>): Promise<ToolResult> {
  const document = currentRevision(args);
  if (isFailure(document)) return document;
  const anchor = anchorFor(document, args);
  if ('success' in anchor) return anchor;
  const target = targetFor(args);
  if ('success' in target) return target;
  return runMutation('Add document media link', () => ({ linkId: useDocumentsStore.getState()
    .addLink(document.id, anchor, target) }));
}
