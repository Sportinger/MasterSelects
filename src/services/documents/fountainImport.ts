import type { DocumentBlock, DocumentBlockKind, ScreenplayLayout } from '../../types/documents';

interface FountainImport {
  blocks: DocumentBlock[];
  titlePage?: ScreenplayLayout['titlePage'];
}

const sceneHeading = /^(?:INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|EST\.)/iu;
const transition = /(?:TO:|FADE OUT\.|FADE TO BLACK\.)$/u;

export function parseFountainDocument(source: string, makeId: () => string): FountainImport {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: DocumentBlock[] = [];
  const title: Record<string, string> = {};
  let cursor = 0;
  let titleKey: string | null = null;
  while (cursor < lines.length) {
    const match = /^([\p{L}][\p{L} ]*):\s*(.*)$/u.exec(lines[cursor]);
    if (match) {
      titleKey = match[1].toLowerCase();
      title[titleKey] = match[2].trim();
    } else if (titleKey && /^(?: {3,}|\t)/u.test(lines[cursor])) {
      title[titleKey] = [title[titleKey], lines[cursor].trim()].filter(Boolean).join('\n');
    } else break;
    cursor++;
  }
  if (cursor > 0) while (cursor < lines.length && !lines[cursor].trim()) cursor++;

  let pendingKind: DocumentBlockKind | null = null;
  let pendingLines: string[] = [];
  let dialogueMode = false;
  const flush = () => {
    if (pendingKind && pendingLines.length) blocks.push({ id: makeId(), kind: pendingKind,
      text: pendingLines.join('\n') });
    pendingKind = null;
    pendingLines = [];
  };
  const append = (kind: DocumentBlockKind, text: string) => {
    if (pendingKind !== kind) flush();
    pendingKind = kind;
    pendingLines.push(text);
  };

  for (; cursor < lines.length; cursor++) {
    const raw = lines[cursor];
    const line = raw.trim();
    if (!line) { flush(); dialogueMode = false; continue; }
    if (/^={3,}$/u.test(line)) {
      flush(); dialogueMode = false;
      blocks.push({ id: makeId(), kind: 'page-break', text: '' });
      continue;
    }
    if (sceneHeading.test(line) || /^\.[A-Z]/u.test(line)) {
      flush(); dialogueMode = false;
      const numbered = /\s+#([^#]+)#\s*$/u.exec(line);
      blocks.push({ id: makeId(), kind: 'scene',
        text: (numbered ? line.slice(0, numbered.index) : line).replace(/^\./u, '').trim(),
        ...(numbered ? { sceneNumber: numbered[1].trim() } : {}) });
      continue;
    }
    if ((line.startsWith('>') && !line.startsWith('>>')) || transition.test(line)) {
      flush(); dialogueMode = false;
      blocks.push({ id: makeId(), kind: 'transition', text: line.replace(/^>\s*/u, '') });
      continue;
    }
    const forcedCue = line.startsWith('@');
    const cue = line.replace(/\^$/u, '').trim().replace(/^@/u, '');
    const next = lines[cursor + 1]?.trim() ?? '';
    const isCue = cue.length < 50 && /\p{L}/u.test(cue)
      && (forcedCue || cue === cue.toLocaleUpperCase()) && Boolean(next)
      && !line.startsWith('!');
    if (isCue) {
      flush(); dialogueMode = true;
      blocks.push({ id: makeId(), kind: line.endsWith('^') ? 'dual-dialogue' : 'character', text: cue });
      continue;
    }
    if (dialogueMode) {
      if (/^\(.*\)$/u.test(line)) append('parenthetical', line);
      else append('dialogue', raw.trimEnd());
    } else append('action', raw.startsWith('!') ? raw.slice(1) : raw);
  }
  flush();
  return {
    blocks: blocks.length ? blocks : [{ id: makeId(), kind: 'action', text: '' }],
    ...(Object.keys(title).length ? { titlePage: { title: title.title ?? '',
      author: title.author ?? title.authors ?? '', contact: title.contact } } : {}),
  };
}
