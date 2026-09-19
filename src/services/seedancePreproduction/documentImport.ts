import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import type { SeedancePlanningDocument } from './contracts';

const MAX_PLAIN_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_PDF_PAGES = 240;
const MAX_STORED_CHARACTERS = 300_000;

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function planningDocumentFormat(file: File): SeedancePlanningDocument['format'] | null {
  const fileExtension = extension(file.name);
  if (file.type === 'application/pdf' || fileExtension === '.pdf') return 'pdf';
  if (file.type === 'text/markdown' || fileExtension === '.md' || fileExtension === '.markdown') {
    return 'markdown';
  }
  if (file.type === 'text/plain' || fileExtension === '.txt') return 'text';
  return null;
}

export function isPlanningDocumentFile(file: File): boolean {
  return planningDocumentFormat(file) !== null;
}

function normalizedText(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+\n/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim();
}

function boundedText(value: string): { text: string; truncated: boolean } {
  const normalized = normalizedText(value);
  if (!normalized) throw new Error('The document contains no machine-readable text.');
  return normalized.length > MAX_STORED_CHARACTERS
    ? { text: normalized.slice(0, MAX_STORED_CHARACTERS), truncated: true }
    : { text: normalized, truncated: false };
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Document read failed.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Document read failed.'));
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(reader.result)
      : reject(new Error('Document read failed.'));
    reader.readAsArrayBuffer(file);
  });
}

async function extractPdfText(file: File): Promise<{
  pageCount: number;
  text: string;
  truncated: boolean;
}> {
  if (file.size > MAX_PDF_BYTES) throw new Error('PDF files must be 40 MB or smaller.');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await readFileAsArrayBuffer(file)),
    stopAtErrors: false,
    useWorkerFetch: false,
  });
  const document = await loadingTask.promise;
  try {
    const pagesToRead = Math.min(document.numPages, MAX_PDF_PAGES);
    const pageTexts: string[] = [];
    let characterCount = 0;
    let truncated = document.numPages > pagesToRead;
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => {
        if (!('str' in item) || typeof item.str !== 'string') return '';
        return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`;
      }).join('');
      page.cleanup();
      pageTexts.push(`Page ${pageNumber}\n${pageText}`);
      characterCount += pageText.length;
      if (characterCount >= MAX_STORED_CHARACTERS) {
        truncated = true;
        break;
      }
    }
    const bounded = boundedText(pageTexts.join('\n\n'));
    return {
      pageCount: document.numPages,
      text: bounded.text,
      truncated: truncated || bounded.truncated,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function extractPlanningDocument(file: File): Promise<SeedancePlanningDocument> {
  const format = planningDocumentFormat(file);
  if (!format) throw new Error('Only TXT, Markdown and PDF planning documents are supported.');
  if (format !== 'pdf' && file.size > MAX_PLAIN_TEXT_BYTES) {
    throw new Error('TXT and Markdown files must be 8 MB or smaller.');
  }

  const extracted: { pageCount?: number; text: string; truncated: boolean } = format === 'pdf'
    ? await extractPdfText(file)
    : boundedText(await readFileAsText(file));
  return {
    id: `seedance-document-${crypto.randomUUID()}`,
    name: file.name,
    mimeType: file.type || (format === 'pdf'
      ? 'application/pdf'
      : format === 'markdown' ? 'text/markdown' : 'text/plain'),
    text: extracted.text,
    truncated: extracted.truncated,
    ...(extracted.pageCount === undefined ? {} : { pageCount: extracted.pageCount }),
    byteLength: file.size,
    createdAt: Date.now(),
    format,
    lastModified: file.lastModified,
  };
}
