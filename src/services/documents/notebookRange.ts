import type { DocumentAnchor, DocumentBlock, ProjectDocument } from '../../types/documents';

export interface NotebookPoint { blockId: string; offset: number }

export function notebookText(blocks: DocumentBlock[]): string {
  return blocks.map(block => block.text).join('\n');
}

/** Only transactions use this separator; soft line breaks remain inside blocks. */
export const NOTEBOOK_PARAGRAPH_BREAK = '\u2029';

export function notebookStructuralText(blocks: DocumentBlock[]): string {
  return blocks.map(block => block.text).join(NOTEBOOK_PARAGRAPH_BREAK);
}

export function notebookOffset(blocks: DocumentBlock[], point: NotebookPoint): number | null {
  let offset = 0;
  for (const block of blocks) {
    if (block.id === point.blockId) {
      return point.offset >= 0 && point.offset <= block.text.length ? offset + point.offset : null;
    }
    offset += block.text.length + 1;
  }
  return null;
}

export function notebookPoint(blocks: DocumentBlock[], position: number): NotebookPoint {
  let remaining = Math.max(0, position);
  for (const block of blocks) {
    if (remaining <= block.text.length) return { blockId: block.id, offset: remaining };
    remaining -= block.text.length + 1;
  }
  const last = blocks.at(-1);
  return { blockId: last?.id ?? '', offset: last?.text.length ?? 0 };
}

export function notebookAnchorOffsets(blocks: DocumentBlock[], anchor: DocumentAnchor): [number, number] | null {
  const start = notebookOffset(blocks, { blockId: anchor.blockId, offset: anchor.start });
  const end = notebookOffset(blocks, { blockId: anchor.endBlockId ?? anchor.blockId, offset: anchor.end });
  return start === null || end === null || start > end ? null : [start, end];
}

export function notebookAnchor(blocks: DocumentBlock[], start: number, end: number): DocumentAnchor {
  const first = notebookPoint(blocks, start);
  const last = notebookPoint(blocks, end);
  return { blockId: first.blockId, start: first.offset,
    ...(last.blockId !== first.blockId ? { endBlockId: last.blockId } : {}),
    end: last.offset, quote: notebookText(blocks).slice(start, end), status: 'resolved' };
}

function mapBoundary(position: number, from: number, to: number, insertedLength: number,
  edge: 'start' | 'end'): number {
  const delta = insertedLength - (to - from);
  if (position < from) return position;
  if (position > to) return position + delta;
  if (from === to) return edge === 'start' ? position + insertedLength : position;
  return edge === 'start' ? from + insertedLength : from;
}

/** One document transaction: text, IDs, ranges and production locks move together. */
export function replaceNotebookText(document: ProjectDocument, from: NotebookPoint, to: NotebookPoint,
  inserted: string, createId: () => string = () => crypto.randomUUID()): ProjectDocument {
  const blocks = document.blocks;
  const start = notebookOffset(blocks, from);
  const end = notebookOffset(blocks, to);
  if (start === null || end === null || start > end) return document;
  if (start === end && !inserted) return document;
  const startIndex = blocks.findIndex(block => block.id === from.blockId);
  const endIndex = blocks.findIndex(block => block.id === to.blockId);
  const first = blocks[startIndex];
  const last = blocks[endIndex];
  const remainder = first.text.slice(0, from.offset) + inserted + last.text.slice(to.offset);
  const lines = remainder.split(NOTEBOOK_PARAGRAPH_BREAK);
  const replacement = lines.map((text, index): DocumentBlock => {
    if (index === 0) {
      const deletedFirst = inserted === '' && from.offset === 0 && to.offset === 0
        && endIndex > startIndex;
      return { ...(deletedFirst ? last : first), text };
    }
    if (index === lines.length - 1 && endIndex > startIndex && to.offset < last.text.length) {
      return { ...last, text };
    }
    return { id: createId(), kind: document.kind === 'screenplay' ? 'action' : 'paragraph', text,
      revisionId: document.screenplay?.activeRevisionId };
  });
  const nextBlocks = [...blocks.slice(0, startIndex), ...replacement, ...blocks.slice(endIndex + 1)];
  const nextText = notebookText(nextBlocks);
  const mapAnchor = (anchor: DocumentAnchor, growEmpty = false): DocumentAnchor => {
    const offsets = notebookAnchorOffsets(blocks, anchor);
    if (!offsets) return { ...anchor, status: 'orphaned' };
    const [oldStart, oldEnd] = offsets;
    const mappedStart = growEmpty && oldStart === oldEnd && start === end && oldStart === start
      ? start : mapBoundary(oldStart, start, end, inserted.length, 'start');
    let mappedEnd = mapBoundary(oldEnd, start, end, inserted.length, 'end');
    if (oldStart === oldEnd && start === end && oldStart === start) {
      mappedEnd = growEmpty ? start + inserted.length : mappedStart;
    } else if (growEmpty && start === end && oldStart < oldEnd && oldEnd === start) {
      mappedEnd = oldEnd + inserted.length;
    }
    mappedEnd = Math.max(mappedStart, mappedEnd);
    const firstPoint = notebookPoint(nextBlocks, mappedStart);
    const lastPoint = notebookPoint(nextBlocks, mappedEnd);
    const deleted = oldStart < oldEnd && start < end && oldStart >= start && oldEnd <= end;
    return { blockId: firstPoint.blockId, start: firstPoint.offset,
      ...(firstPoint.blockId !== lastPoint.blockId ? { endBlockId: lastPoint.blockId } : {}),
      end: lastPoint.offset,
      quote: deleted || anchor.status === 'orphaned' ? anchor.quote : nextText.slice(mappedStart, mappedEnd),
      status: deleted || anchor.status === 'orphaned' || (oldStart < oldEnd && mappedStart === mappedEnd)
        ? 'orphaned' : 'resolved' };
  };
  return { ...document, schemaVersion: 2, blocks: nextBlocks,
    links: document.links.map(item => ({ ...item, anchor: mapAnchor(item.anchor) })),
    comments: document.comments.map(item => ({ ...item, anchor: mapAnchor(item.anchor) })),
    labels: document.labels?.map(item => ({ ...item, anchor: mapAnchor(item.anchor) })),
    scenes: document.scenes?.map(item => ({ ...item, anchor: mapAnchor(item.anchor, true) })),
    formats: document.formats?.map(item => ({ ...item, anchor: mapAnchor(item.anchor) })),
    screenplay: document.screenplay ? { ...document.screenplay,
      pageLocks: document.screenplay.pageLocks?.map(lock => {
        const old = notebookOffset(blocks, { blockId: lock.blockId, offset: lock.offset });
        const point = notebookPoint(nextBlocks, old === null ? 0 : mapBoundary(old, start, end, inserted.length, 'start'));
        return { ...lock, blockId: point.blockId, offset: point.offset };
      }),
    } : undefined,
    revision: document.revision + 1, updatedAt: Date.now() };
}
