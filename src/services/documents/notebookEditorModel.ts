import { Schema, type Mark, type Node as ProseMirrorNode } from 'prosemirror-model';
import type { DocumentBlockKind, NotebookFormat, ProjectDocument } from '../../types/documents';
import { NOTEBOOK_PARAGRAPH_BREAK, notebookAnchorOffsets } from './notebookRange';

const kinds = new Set<DocumentBlockKind>([
  'paragraph', 'heading', 'list', 'quote', 'code', 'table', 'scene', 'action', 'character',
  'dialogue', 'parenthetical', 'transition', 'dual-dialogue', 'page-break',
]);

export const notebookEditorSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*', group: 'block', attrs: { kind: { default: 'paragraph' } },
      parseDOM: [
        { tag: 'p', getAttrs: dom => ({ kind: (dom as HTMLElement).dataset.kind ?? 'paragraph' }) },
        { tag: 'h1', attrs: { kind: 'heading' } },
        { tag: 'h2', attrs: { kind: 'heading' } },
        { tag: 'li', attrs: { kind: 'list' } },
        { tag: 'blockquote', attrs: { kind: 'quote' } },
        { tag: 'pre', attrs: { kind: 'code' } },
      ],
      toDOM: node => ['p', { 'data-kind': node.attrs.kind as string,
        class: `notebook-paragraph notebook-${node.attrs.kind as string}` }, 0],
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false,
      parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  },
  marks: {
    bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  },
});

function textNodes(text: string, formatRanges: Array<{ from: number; to: number; kind: NotebookFormat['kind'] }>,
  base: number): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  const boundaries = new Set([0, text.length]);
  for (const range of formatRanges) {
    boundaries.add(Math.max(0, Math.min(text.length, range.from - base)));
    boundaries.add(Math.max(0, Math.min(text.length, range.to - base)));
  }
  const cuts = [...boundaries].toSorted((a, b) => a - b);
  for (let index = 0; index < cuts.length - 1; index++) {
    const from = cuts[index];
    const to = cuts[index + 1];
    if (from === to) continue;
    const marks: Mark[] = formatRanges.filter(range => range.from <= base + from && range.to >= base + to)
      .map(range => notebookEditorSchema.marks[range.kind].create());
    const pieces = text.slice(from, to).split('\n');
    pieces.forEach((piece, pieceIndex) => {
      if (pieceIndex > 0) nodes.push(notebookEditorSchema.nodes.hard_break.create());
      if (piece) nodes.push(notebookEditorSchema.text(piece, marks));
    });
  }
  return nodes;
}

export function createNotebookEditorDocument(document: ProjectDocument): ProseMirrorNode {
  const ranges = (document.formats ?? []).flatMap(format => {
    const offsets = notebookAnchorOffsets(document.blocks, format.anchor);
    return offsets && format.anchor.status === 'resolved'
      ? [{ from: offsets[0], to: offsets[1], kind: format.kind }] : [];
  });
  let base = 0;
  const paragraphs = document.blocks.map(block => {
    const content = textNodes(block.text, ranges, base);
    base += block.text.length + 1;
    return notebookEditorSchema.nodes.paragraph.create({ kind: block.kind }, content);
  });
  return notebookEditorSchema.nodes.doc.create(null,
    paragraphs.length ? paragraphs : [notebookEditorSchema.nodes.paragraph.create()]);
}

export function notebookEditorText(document: ProseMirrorNode): string {
  const parts: string[] = [];
  document.forEach(block => parts.push(block.textBetween(0, block.content.size, '', '\n')));
  return parts.join(NOTEBOOK_PARAGRAPH_BREAK);
}

export function notebookEditorBlockKinds(document: ProseMirrorNode): DocumentBlockKind[] {
  const result: DocumentBlockKind[] = [];
  document.forEach(block => result.push(kinds.has(block.attrs.kind as DocumentBlockKind)
    ? block.attrs.kind as DocumentBlockKind : 'paragraph'));
  return result;
}

export function notebookEditorPositionToOffset(document: ProseMirrorNode, position: number): number {
  let offset = 0;
  let result = 0;
  let found = false;
  document.forEach((block, nodePosition) => {
    if (found) return;
    const start = nodePosition + 1;
    const length = block.textBetween(0, block.content.size, '', '\n').length;
    if (position <= nodePosition + block.nodeSize) {
      result = offset + Math.max(0, Math.min(position - start, length));
      found = true;
    } else offset += length + 1;
  });
  return found ? result : notebookEditorText(document).length;
}

export function notebookEditorOffsetToPosition(document: ProseMirrorNode, target: number): number {
  let offset = 0;
  let position = document.content.size - 1;
  let found = false;
  document.forEach((block, nodePosition) => {
    if (found) return;
    const length = block.textBetween(0, block.content.size, '', '\n').length;
    if (target <= offset + length) {
      position = nodePosition + 1 + Math.max(0, target - offset);
      found = true;
    } else offset += length + 1;
  });
  return position;
}

export function notebookEditorFormatRanges(document: ProseMirrorNode): Array<{
  from: number; to: number; kind: NotebookFormat['kind']
}> {
  const formats: Array<{ from: number; to: number; kind: NotebookFormat['kind'] }> = [];
  let absolute = 0;
  document.forEach(block => {
    block.descendants((node, position) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type.name !== 'bold' && mark.type.name !== 'italic') continue;
        const start = absolute + position;
        const end = start + node.text!.length;
        formats.push({ from: start, to: end, kind: mark.type.name });
      }
    });
    absolute += block.textBetween(0, block.content.size, '', '\n').length + 1;
  });
  return formats;
}
