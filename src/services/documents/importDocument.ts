import { unzipSync, strFromU8 } from 'fflate';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { DocumentBlock, DocumentBlockKind, DocumentKind, DocumentSource, ScreenplayLayout } from '../../types/documents';
import { parseFountainDocument } from './fountainImport';

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_TEXT = 8 * 1024 * 1024;
const textId = () => crypto.randomUUID();

export function isDocumentImportCandidate(file: File): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('text/')
    || /\.(pdf|txt|log|md|markdown|html?|fountain|fdx|docx|odt|rtf|json|xml|ya?ml|csv|tsv|srt|vtt)$/iu.test(file.name);
}

function decodeText(bytes: Uint8Array, selectedEncoding?: string): string {
  if (bytes.some((byte, index) => index < 4096 && byte === 0) &&
    !(bytes[0] === 0xff && bytes[1] === 0xfe) && !(bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error('This file contains binary data, not readable text.');
  }
  const encoding = selectedEncoding ?? (bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8');
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('Text encoding is unclear. Choose an encoding and retry.'); }
  const sample = text.slice(0, 8192);
  const controls = [...sample].filter(char => char.charCodeAt(0) < 32 && !'\n\r\t\f'.includes(char)).length;
  if (sample && controls / sample.length > 0.01) throw new Error('This file contains binary data, not readable text.');
  return text;
}

function xmlText(xml: string, tags: string[]): string[] {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror')) throw new Error('The document XML is damaged.');
  const elements = [...parsed.getElementsByTagName('*')].filter(element => tags.includes(element.localName));
  return elements.map(element => element.textContent?.trim() ?? '').filter(Boolean);
}

function classifyLine(line: string, format: string): DocumentBlockKind {
  if (format === 'fountain' || format === 'fdx') {
    if (/^(INT\.|EXT\.|INT\/EXT\.|EST\.)/iu.test(line)) return 'scene';
    if (/^(CUT TO:|FADE OUT\.|DISSOLVE TO:)/iu.test(line)) return 'transition';
    if (/^\(.+\)$/u.test(line)) return 'parenthetical';
    if (/^[\p{Lu}\d .'()_-]+\^?$/u.test(line) && line.length < 50) return line.endsWith('^') ? 'dual-dialogue' : 'character';
    return 'action';
  }
  if (format === 'markdown') {
    if (/^#{1,6} /u.test(line)) return 'heading';
    if (/^\s*([-*+] |\d+\. )/u.test(line)) return 'list';
    if (/^> /u.test(line)) return 'quote';
    if (/^```/u.test(line)) return 'code';
  }
  if (format === 'code') return 'code';
  return 'paragraph';
}

function blocksFromText(text: string, format: string): DocumentBlock[] {
  if (format === 'markdown') return blocksFromMarkdown(text);
  if (format === 'html') return blocksFromHtml(text);
  if (format === 'fdx') return blocksFromFdx(text);
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  return lines.map(line => ({ id: textId(), kind: classifyLine(line, format), text: line }));
}

function blocksFromMarkdown(source: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  let code: string[] | null = null;
  for (const line of source.replace(/\r\n?/gu, '\n').split('\n')) {
    if (/^\s*```/u.test(line)) {
      if (code) { blocks.push({ id: textId(), kind: 'code', text: code.join('\n') }); code = null; }
      else code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const heading = /^#{1,6}\s+(.+)$/u.exec(line);
    const list = /^\s*(?:[-*+] |\d+\. )(.+)$/u.exec(line);
    const quote = /^>\s?(.*)$/u.exec(line);
    blocks.push({ id: textId(), kind: heading ? 'heading' : list ? 'list' : quote ? 'quote'
      : /^\|.*\|$/u.test(line) ? 'table' : 'paragraph',
    text: heading?.[1] ?? list?.[1] ?? quote?.[1] ?? line });
  }
  if (code) blocks.push({ id: textId(), kind: 'code', text: code.join('\n') });
  return blocks;
}

function blocksFromHtml(source: string): DocumentBlock[] {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  parsed.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove());
  const blocks: DocumentBlock[] = [];
  const candidates = parsed.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table');
  candidates.forEach(element => {
    if (element.closest('table') && element.tagName.toLowerCase() !== 'table') return;
    const tag = element.tagName.toLowerCase();
    const kind: DocumentBlockKind = tag.startsWith('h') ? 'heading' : tag === 'li' ? 'list'
      : tag === 'blockquote' ? 'quote' : tag === 'pre' ? 'code' : tag === 'table' ? 'table' : 'paragraph';
    const text = tag === 'table'
      ? [...element.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')]
        .map(cell => cell.textContent?.trim() ?? '').join('\t')).join('\n')
      : element.textContent?.trim() ?? '';
    if (text) blocks.push({ id: textId(), kind, text });
  });
  if (blocks.length === 0 && parsed.body.textContent?.trim()) {
    blocks.push({ id: textId(), kind: 'paragraph', text: parsed.body.textContent.trim() });
  }
  return blocks;
}

function blocksFromFdx(source: string): DocumentBlock[] {
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('The Final Draft XML is damaged.');
  const kinds: Record<string, DocumentBlockKind> = {
    'Scene Heading': 'scene', Action: 'action', Character: 'character',
    Dialogue: 'dialogue', Parenthetical: 'parenthetical', Transition: 'transition',
  };
  const paragraph = (element: Element, dualCharacter = false): DocumentBlock => ({
    id: textId(),
    kind: dualCharacter ? 'dual-dialogue' : kinds[element.getAttribute('Type') ?? ''] ?? 'action',
    text: [...element.children].filter(child => child.localName === 'Text')
      .map(child => child.textContent ?? '').join(''),
    ...(element.getAttribute('Number') ? { sceneNumber: element.getAttribute('Number')! } : {}),
  });
  const content = xml.getElementsByTagName('Content')[0];
  if (!content) throw new Error('The Final Draft XML has no script content.');
  return [...content.children].flatMap(element => {
    if (element.localName !== 'Paragraph') return [];
    const dual = [...element.children].find(child => child.localName === 'DualDialogue');
    if (!dual) return [paragraph(element)];
    let characterCount = 0;
    return [...dual.children].filter(child => child.localName === 'Paragraph').map(child => {
      if (child.getAttribute('Type') === 'Character') characterCount++;
      return paragraph(child, child.getAttribute('Type') === 'Character' && characterCount === 2);
    });
  });
}

function safeHtmlPreview(original: string): string {
  const parsed = new DOMParser().parseFromString(original, 'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,form,link,base,meta,style,svg').forEach(node => node.remove());
  parsed.querySelectorAll('*').forEach(node => {
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
  });
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<style>body{font:16px/1.5 sans-serif;padding:24px;color:#111;background:#fff}table{border-collapse:collapse}td,th{border:1px solid #888;padding:4px}</style>`
    + parsed.body.innerHTML;
}

function formatFromFile(file: File, bytes: Uint8Array): string {
  const name = file.name.toLowerCase();
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.odt')) return 'odt';
    throw new Error('This archive is not a supported document format.');
  }
  if (name.endsWith('.fountain')) return 'fountain';
  if (name.endsWith('.fdx')) return 'fdx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (name.endsWith('.rtf')) return 'rtf';
  if (/\.(js|ts|tsx|jsx|css|wgsl|py|rs|go|java|c|cpp|json|xml|yaml|yml|csv|tsv|srt|vtt)$/u.test(name)) return 'code';
  return 'text';
}

async function pdfPages(bytes: Uint8Array): Promise<{ pages: string[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  // PDF.js transfers its input buffer to the worker. Keep our copy intact so
  // the original pages can be stored alongside the extracted text.
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      page.cleanup();
    }
    return { pages, pageCount: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

function base64(bytes: Uint8Array): string {
  let result = '';
  for (let start = 0; start < bytes.length; start += 32768) {
    result += String.fromCharCode(...bytes.subarray(start, start + 32768));
  }
  return btoa(result);
}

export async function importProjectDocument(file: File, selectedEncoding?: string): Promise<{
  kind: DocumentKind; blocks: DocumentBlock[]; source: DocumentSource;
  screenplayTitlePage?: ScreenplayLayout['titlePage'];
}> {
  if (file.size > MAX_BYTES) throw new Error('Documents over 40 MB require a smaller source file.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = formatFromFile(file, bytes);
  let text = '';
  let pageCount: number | undefined;
  let fidelity: DocumentSource['fidelity'] = 'source';
  let report: string | undefined;
  let importedBlocks: DocumentBlock[] | undefined;
  let previewHtml: string | undefined;
  let screenplayTitlePage: ScreenplayLayout['titlePage'] | undefined;
  if (format === 'pdf') {
    const pdf = await pdfPages(bytes);
    text = pdf.pages.join('\n\n');
    importedBlocks = pdf.pages.flatMap((page, index) => blocksFromText(page, 'text')
      .map(block => ({ ...block, sourcePage: index + 1 })));
    pageCount = pdf.pageCount;
    fidelity = 'approximate';
    if (!text.trim()) report = 'This PDF has no selectable text. Its original pages remain available; OCR is not available.';
  } else if (format === 'docx' || format === 'odt') {
    const archive = unzipSync(bytes);
    const entry = archive[format === 'docx' ? 'word/document.xml' : 'content.xml'];
    if (!entry) throw new Error(`This ${format.toUpperCase()} file has no readable document body.`);
    text = xmlText(strFromU8(entry), format === 'docx' ? ['p'] : ['p', 'h']).join('\n');
    fidelity = 'text-only';
    report = 'Text and paragraph order were imported; the original page layout is unavailable.';
  } else {
    text = decodeText(bytes, selectedEncoding);
    if (format === 'fountain') {
      const parsed = parseFountainDocument(text, textId);
      importedBlocks = parsed.blocks;
      screenplayTitlePage = parsed.titlePage;
    } else if (format === 'fdx') {
      // Keep the original XML for structured FDX parsing below.
      text = decodeText(bytes, selectedEncoding);
      fidelity = 'text-only';
      report = 'Final Draft paragraphs were imported; production metadata may require review.';
    } else if (format === 'html') {
      previewHtml = safeHtmlPreview(text);
      const parsed = new DOMParser().parseFromString(text, 'text/html');
      parsed.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove());
      text = parsed.body.innerText || parsed.body.textContent || '';
      fidelity = 'approximate';
      report = 'Active content and external resources are removed from the original preview.';
    } else if (format === 'rtf') {
      text = text.replace(/\\par\b/gu, '\n').replace(/\\'[0-9a-f]{2}/giu, '')
        .replace(/\\[a-z]+-?\d* ?/giu, '').replace(/[{}]/gu, '');
      fidelity = 'text-only';
      report = 'RTF text was imported without page layout.';
    }
  }
  if (text.length > MAX_TEXT) throw new Error('Extracted text exceeds 8 million characters; the document was not imported.');
  const kind: DocumentKind = format === 'fountain' || format === 'fdx' ? 'screenplay' : 'general';
  const source: DocumentSource = {
    fileName: file.name, mimeType: file.type || 'application/octet-stream', format,
    importedAt: Date.now(), byteLength: file.size,
    originalText: format === 'pdf' ? undefined : format === 'docx' || format === 'odt' ? text : decodeText(bytes, selectedEncoding),
    originalData: ['pdf', 'docx', 'odt'].includes(format) ? base64(bytes) : undefined,
    previewHtml,
    fidelity, report: selectedEncoding ? `${report ? `${report} ` : ''}Decoded as ${selectedEncoding}.` : report, pageCount,
  };
  return { kind, blocks: importedBlocks ?? blocksFromText(format === 'html' ? source.originalText ?? text : text, format),
    source, screenplayTitlePage };
}
