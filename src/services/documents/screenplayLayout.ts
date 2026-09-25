import type { DocumentBlock, ProjectDocument } from '../../types/documents';

export interface ScreenplayLine {
  blockId: string;
  kind: DocumentBlock['kind'];
  text: string;
  x: number;
  y: number;
  revisionId?: string;
  sourceOffset: number;
  synthetic?: boolean;
}

export interface ScreenplayPage {
  label: string;
  width: number;
  height: number;
  lines: ScreenplayLine[];
  firstBlockId: string | null;
  firstLineKey: string | null;
  firstLineOffset: number | null;
  lockedLabel?: string;
  titlePage?: boolean;
}

const FONT_SIZE = 12;
const LINE_HEIGHT = 12;
const CHAR_WIDTH = 7.1953125;
const TOP = 72;
const BOTTOM = 72;

const geometry = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

export function screenplayTitlePage(document: ProjectDocument): ScreenplayPage | null {
  const title = document.screenplay?.titlePage;
  if (!title || ![title.title, title.author, title.contact].some(value => value?.trim())) return null;
  const size = geometry[document.screenplay?.pageSize ?? 'letter'];
  const lines: ScreenplayLine[] = [];
  const center = (text: string, y: number) => {
    if (text.trim()) lines.push({ blockId: 'title-page', kind: 'paragraph', text,
      x: Math.max(72, (size.width - text.length * CHAR_WIDTH) / 2), y, sourceOffset: 0 });
  };
  center(title.title || document.title, size.height * 0.35);
  if (title.author.trim()) {
    center('written by', size.height * 0.43);
    center(title.author, size.height * 0.46);
  }
  const contactLines = title.contact?.split('\n') ?? [];
  contactLines.forEach((line, index) => {
    if (line.trim()) lines.push({ blockId: 'title-page', kind: 'paragraph', text: line,
      x: 108, y: size.height - 108 - (contactLines.length - index) * LINE_HEIGHT, sourceOffset: 0 });
  });
  return { label: '', width: size.width, height: size.height, lines,
    firstBlockId: null, firstLineKey: null, firstLineOffset: null, titlePage: true };
}

function startX(kind: DocumentBlock['kind']): number {
  switch (kind) {
    case 'character': case 'dual-dialogue': return 252;
    case 'dialogue': return 180;
    case 'parenthetical': return 216;
    case 'transition': return 360;
    default: return 108;
  }
}

function endMargin(kind: DocumentBlock['kind']): number {
  switch (kind) {
    case 'dialogue': return 108;
    case 'parenthetical': return 144;
    default: return 72;
  }
}

interface WrappedLine { text: string; offset: number }
interface ParallelLine extends WrappedLine {
  block: DocumentBlock;
  x: number;
  lockLabel?: string;
  synthetic?: boolean;
}

function isDialogueChild(kind: DocumentBlock['kind'] | undefined): boolean {
  return kind === 'parenthetical' || kind === 'dialogue';
}

function wrap(text: string, columns: number): WrappedLine[] {
  if (!text) return [{ text: '', offset: 0 }];
  const result: WrappedLine[] = [];
  let paragraphStart = 0;
  for (const paragraph of text.split('\n')) {
    let remaining = paragraph;
    let consumed = 0;
    if (!remaining) { result.push({ text: '', offset: paragraphStart }); paragraphStart++; continue; }
    while (remaining.length > columns) {
      let cut = remaining.lastIndexOf(' ', columns + 1);
      if (cut < columns / 2) cut = columns;
      result.push({ text: remaining.slice(0, cut).trimEnd(), offset: paragraphStart + consumed });
      const tail = remaining.slice(cut);
      const skipped = tail.length - tail.trimStart().length;
      remaining = tail.trimStart();
      consumed += cut + skipped;
    }
    result.push({ text: remaining, offset: paragraphStart + consumed });
    paragraphStart += paragraph.length + 1;
  }
  return result;
}

export function nextProductionSuffix(index: number): string {
  let value = index;
  let label = '';
  do { label = String.fromCharCode(65 + value % 26) + label; value = Math.floor(value / 26) - 1; } while (value >= 0);
  return label;
}

function pageLabels(pages: ScreenplayPage[], document: ProjectDocument): void {
  const locks = document.screenplay?.pageLocks;
  const legacyLocks = document.screenplay?.lockedPages;
  if (!locks?.length && !Object.keys(legacyLocks ?? {}).length) {
    pages.forEach((page, index) => { page.label = String(index + 1); });
    return;
  }
  let priorNumber = 0;
  let suffix = 0;
  for (const page of pages) {
    const locked = page.lockedLabel ?? locks?.find(lock => lock.blockId === page.firstBlockId
      && lock.offset === page.firstLineOffset)?.label
      ?? (page.firstLineKey ? legacyLocks?.[page.firstLineKey] : undefined)
      ?? (page.firstBlockId ? legacyLocks?.[page.firstBlockId] : undefined);
    if (locked) {
      page.label = locked;
      priorNumber = Number.parseInt(locked, 10) || priorNumber;
      suffix = 0;
    } else if (priorNumber > 0) {
      page.label = `${priorNumber}${nextProductionSuffix(suffix++)}`;
    } else {
      page.label = `0${nextProductionSuffix(suffix++)}`;
    }
  }
}

export function paginateScreenplay(document: ProjectDocument): ScreenplayPage[] {
  const size = geometry[document.screenplay?.pageSize ?? 'letter'];
  const maxLines = Math.floor((size.height - TOP - BOTTOM) / LINE_HEIGHT);
  const pages: ScreenplayPage[] = [];
  let lines: ScreenplayLine[] = [];
  let usedRows = 0;
  let firstBlockId: string | null = null;
  let firstLineKey: string | null = null;
  let firstLineOffset: number | null = null;
  let lockedLabel: string | undefined;
  const lineOrdinals = new Map<string, number>();
  const finishPage = () => {
    pages.push({ label: '', width: size.width, height: size.height, lines,
      firstBlockId, firstLineKey, firstLineOffset, lockedLabel });
    lines = [];
    usedRows = 0;
    firstBlockId = null;
    firstLineKey = null;
    firstLineOffset = null;
    lockedLabel = undefined;
  };
  const pushLine = (block: DocumentBlock, text: string, sourceOffset: number,
    x: number, synthetic = false) => {
    const ordinal = lineOrdinals.get(block.id) ?? 0;
    if (!synthetic) lineOrdinals.set(block.id, ordinal + 1);
    if (!firstBlockId && !synthetic) {
      firstBlockId = block.id;
      firstLineKey = `${block.id}:${ordinal}`;
      firstLineOffset = sourceOffset;
    }
    lines.push({ blockId: block.id, kind: block.kind, text,
      x, y: TOP + usedRows * LINE_HEIGHT,
      revisionId: block.revisionId, sourceOffset, synthetic });
  };
  const addLine = (block: DocumentBlock, text: string, sourceOffset: number,
    pageLockLabel?: string, synthetic = false) => {
    if (pageLockLabel && firstBlockId) finishPage();
    if (usedRows >= maxLines) finishPage();
    if (pageLockLabel) lockedLabel = pageLockLabel;
    pushLine(block, text, sourceOffset, startX(block.kind), synthetic);
    usedRows++;
  };
  const addParallelRow = (left?: ParallelLine, right?: ParallelLine) => {
    const lock = left?.lockLabel ?? right?.lockLabel;
    if (lock && firstBlockId) finishPage();
    if (usedRows >= maxLines) finishPage();
    if (lock) lockedLabel = lock;
    if (left) pushLine(left.block, left.text, left.offset, left.x, left.synthetic);
    if (right) pushLine(right.block, right.text, right.offset, right.x, right.synthetic);
    usedRows++;
  };
  const renderDualDialogue = (leftBlocks: DocumentBlock[], rightBlocks: DocumentBlock[]) => {
    const leftX = 108;
    const columnWidth = (size.width - 108 - 72 - 18) / 2;
    const rightX = leftX + columnWidth + 18;
    const buildColumn = (blocks: DocumentBlock[], baseX: number): ParallelLine[] => blocks.flatMap(block => {
      const inset = block.kind === 'parenthetical' ? 20
        : block.kind === 'character' || block.kind === 'dual-dialogue' ? 48 : 0;
      const width = Math.max(8, Math.floor((columnWidth - inset) / CHAR_WIDTH));
      const result: ParallelLine[] = wrap(block.text, width).map(line => ({
        ...line, block, x: baseX + inset,
      }));
      for (const lock of document.screenplay?.pageLocks ?? []) {
        if (lock.blockId !== block.id) continue;
        const lineIndex = result.findIndex(line => line.offset >= lock.offset);
        const target = result[lineIndex < 0 ? result.length - 1 : lineIndex];
        if (target) target.lockLabel = lock.label;
      }
      return result;
    });
    const left = buildColumn(leftBlocks, leftX);
    const right = buildColumn(rightBlocks, rightX);
    const totalRows = Math.max(left.length, right.length);
    const continuation = (blocks: DocumentBlock[], baseX: number): ParallelLine => ({
      block: blocks[0], text: `${blocks[0].text} (CONT'D)`, offset: blocks[0].text.length,
      x: baseX + 48, synthetic: true,
    });
    const more = (block: DocumentBlock, baseX: number): ParallelLine => ({
      block, text: '(MORE)', offset: block.text.length, x: baseX + 48, synthetic: true,
    });
    let position = 0;
    while (position < totalRows) {
      if (usedRows && maxLines - usedRows < 3) finishPage();
      const available = maxLines - usedRows;
      const remaining = totalRows - position;
      let nextLock = remaining;
      for (let offset = firstBlockId ? 0 : 1; offset < remaining; offset++) {
        if (left[position + offset]?.lockLabel || right[position + offset]?.lockLabel) {
          nextLock = offset;
          break;
        }
      }
      const take = Math.min(remaining, remaining > available ? available - 1 : available,
        nextLock);
      if (take === 0) {
        if (position === 0) { finishPage(); continue; }
        addParallelRow(position < left.length ? more(leftBlocks.at(-1)!, leftX) : undefined,
          position < right.length ? more(rightBlocks.at(-1)!, rightX) : undefined);
        finishPage();
        addParallelRow(position < left.length ? continuation(leftBlocks, leftX) : undefined,
          position < right.length ? continuation(rightBlocks, rightX) : undefined);
        continue;
      }
      for (let offset = 0; offset < take; offset++) {
        addParallelRow(left[position + offset], right[position + offset]);
      }
      position += take;
      if (position < totalRows) {
        addParallelRow(position < left.length ? more(leftBlocks.at(-1)!, leftX) : undefined,
          position < right.length ? more(rightBlocks.at(-1)!, rightX) : undefined);
        finishPage();
        addParallelRow(position < left.length ? continuation(leftBlocks, leftX) : undefined,
          position < right.length ? continuation(rightBlocks, rightX) : undefined);
      }
    }
  };
  let sceneNumber = 0;
  for (let index = 0; index < document.blocks.length; index++) {
    const block = document.blocks[index];
    if (block.kind === 'page-break') { if (usedRows) finishPage(); continue; }
    if (block.kind === 'character') {
      let rightStart = index + 1;
      while (isDialogueChild(document.blocks[rightStart]?.kind)) rightStart++;
      if (document.blocks[rightStart]?.kind === 'dual-dialogue'
        && document.blocks.slice(index + 1, rightStart).some(item => item.kind === 'dialogue')) {
        let pairEnd = rightStart + 1;
        while (isDialogueChild(document.blocks[pairEnd]?.kind)) pairEnd++;
        if (document.blocks.slice(rightStart + 1, pairEnd).some(item => item.kind === 'dialogue')) {
          renderDualDialogue(document.blocks.slice(index, rightStart), document.blocks.slice(rightStart, pairEnd));
          index = pairEnd - 1;
          continue;
        }
      }
    }
    const width = Math.max(8, Math.floor((size.width - startX(block.kind) - endMargin(block.kind)) / CHAR_WIDTH));
    let value = block.text;
    let sourcePrefixLength = 0;
    if (block.kind === 'scene') {
      sceneNumber++;
      if (document.screenplay?.sceneNumbers) {
        const prefix = `${block.sceneNumber ?? sceneNumber}  `;
        value = `${prefix}${value}`;
        sourcePrefixLength = prefix.length;
      }
    }
    if (block.omitted) value = `${value} (OMITTED)`;
    const wrapped = wrap(value, width).map(line => ({
      ...line, offset: Math.min(block.text.length, Math.max(0, line.offset - sourcePrefixLength)),
      lockLabel: undefined as string | undefined,
    }));
    for (const lock of document.screenplay?.pageLocks ?? []) {
      if (lock.blockId !== block.id) continue;
      const lineIndex = wrapped.findIndex(line => line.offset >= lock.offset);
      const target = wrapped[Math.max(0, lineIndex < 0 ? wrapped.length - 1 : lineIndex)];
      if (target) target.lockLabel = lock.label;
    }
    const needsWithNext = block.kind === 'character' || block.kind === 'dual-dialogue' || block.kind === 'scene';
    if (needsWithNext && maxLines - usedRows < Math.min(maxLines, wrapped.length + 2)) finishPage();
    if (block.kind === 'dialogue') {
      const parent = document.blocks[index - 1];
      wrapped.forEach((line, lineIndex) => {
        const hasMore = lineIndex < wrapped.length - 1;
        if ((line.lockLabel && firstBlockId) || usedRows + (hasMore ? 2 : 1) > maxLines) {
          if (usedRows < maxLines && lineIndex > 0) {
            addLine(block, '(MORE)', line.offset, undefined, true);
          }
          finishPage();
          if (parent?.kind === 'character' || parent?.kind === 'dual-dialogue') {
            addLine(parent, `${parent.text} (CONT'D)`, parent.text.length, undefined, true);
          }
        }
        addLine(block, line.text, line.offset, line.lockLabel);
      });
    } else {
      for (const line of wrapped) addLine(block, line.text, line.offset, line.lockLabel);
    }
    if (block.kind === 'scene' || block.kind === 'action') {
      if (usedRows && usedRows < maxLines) addLine(block, '', block.text.length, undefined, true);
    }
  }
  if (lines.length || pages.length === 0) finishPage();
  pageLabels(pages, document);
  return pages;
}

export const screenplayMetrics = { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, charWidth: CHAR_WIDTH };
