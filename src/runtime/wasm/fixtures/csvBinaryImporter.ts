import type { ExtensionProviderManifest } from '../../../extensions';
import type { SignalKind, SignalMetadata } from '../../../signals';
import type { WasmImportRequest, WasmImportResult, WasmSignalRef } from '../types';

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'text/plain']);
const DEFAULT_BINARY_MIME_TYPE = 'application/octet-stream';

export const manifest: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: 'fixture.wasm.csv-binary-importer',
  version: '0.1.0',
  displayName: 'Fixture Wasm CSV/Binary Importer',
  role: 'importer',
  runtime: 'wasm',
  capabilities: ['file.read', 'artifact.write'],
  fileSignatures: [
    {
      extensions: ['csv'],
      mimeTypes: ['text/csv', 'application/csv'],
    },
    {
      extensions: ['bin', 'dat'],
      mimeTypes: [DEFAULT_BINARY_MIME_TYPE],
    },
  ],
  signals: {
    outputKinds: ['table', 'metadata', 'binary'],
  },
  entrypoint: {
    module: 'src/runtime/wasm/fixtures/csvBinaryImporter.ts',
  },
  metadata: {
    witPackage: 'masterselects:runtime@0.1.0',
    witWorld: 'masterselects-importer',
    fixture: true,
  },
};

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function getExtension(fileName: string): string {
  return fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
}

function looksLikeCsvHeader(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.includes(',') || firstLine.includes(';') || firstLine.includes('\t');
}

function delimiterFor(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t'];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length - 1,
    }))
    .toSorted((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((candidate, index) => (
    index < rows.length - 1 ||
    candidate.length !== 1 ||
    candidate[0] !== ''
  ));
}

function inferColumnType(values: string[]): 'empty' | 'number' | 'boolean' | 'string' {
  const present = values.map((value) => value.trim()).filter(Boolean);
  if (present.length === 0) return 'empty';
  if (present.every((value) => value === 'true' || value === 'false')) return 'boolean';
  if (present.every((value) => Number.isFinite(Number(value)))) return 'number';
  return 'string';
}

function csvMetadata(bytes: Uint8Array, fileName: string): SignalMetadata {
  const text = bytesToText(bytes);
  const delimiter = delimiterFor(text);
  const rows = parseDelimited(text, delimiter);
  const headers = rows[0]?.map((header, index) => header.trim() || `column_${index + 1}`) ?? [];
  const dataRows = rows.slice(1);
  const columnTypes = headers.map((header, index) => ({
    name: header,
    type: inferColumnType(dataRows.map((row) => row[index] ?? '')),
  }));

  return {
    format: 'csv',
    fileName,
    byteLength: bytes.byteLength,
    delimiter,
    columnCount: headers.length,
    rowCount: dataRows.length,
    columns: headers,
    columnTypes,
    previewRows: dataRows.slice(0, 5),
  };
}

function binaryMetadata(bytes: Uint8Array, fileName: string, mimeType: string): SignalMetadata {
  const prefixBytes = Array.from(bytes.slice(0, 16)).map((byte) => byte.toString(16).padStart(2, '0'));

  return {
    format: 'binary',
    fileName,
    mimeType,
    byteLength: bytes.byteLength,
    empty: bytes.byteLength === 0,
    headerHex: prefixBytes.join(' '),
  };
}

function isCsvRequest(fileName: string, mimeType: string, header: Uint8Array): boolean {
  const extension = getExtension(fileName);
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (extension === 'csv') return true;
  if (CSV_MIME_TYPES.has(normalizedMimeType) && looksLikeCsvHeader(bytesToText(header))) return true;
  return false;
}

function arrayBufferFor(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function fallbackHash(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return fallbackHash(bytes);
  }

  const digest = await subtle.digest('SHA-256', arrayBufferFor(bytes));
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function safeIdPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'asset';
}

function createSignal(
  fileName: string,
  kind: SignalKind,
  metadata: SignalMetadata,
  hash: string,
  mimeType: string,
  size: number,
): WasmSignalRef {
  const shortHash = hash.split(':').at(-1)?.slice(0, 12) ?? 'unknown';
  const id = `${safeIdPart(fileName)}:${kind}:${shortHash}`;

  return {
    id,
    kind,
    artifact: {
      id: `artifact:${shortHash}`,
      hash,
      mimeType,
      size,
    },
    metadataJson: JSON.stringify(metadata),
  };
}

export function canImport(fileName: string, mimeType: string, header: Uint8Array): boolean {
  return isCsvRequest(fileName, mimeType, header) || header.byteLength >= 0;
}

export async function importFile(request: WasmImportRequest): Promise<WasmImportResult> {
  const mimeType = normalizeMimeType(request.mimeType) || DEFAULT_BINARY_MIME_TYPE;
  const hash = await hashBytes(request.bytes);
  const csv = isCsvRequest(request.fileName, mimeType, request.bytes.slice(0, 4096));
  const metadata = csv
    ? csvMetadata(request.bytes, request.fileName)
    : binaryMetadata(request.bytes, request.fileName, mimeType);
  const primaryKind: SignalKind = csv ? 'table' : 'binary';
  const signals = [
    createSignal(request.fileName, primaryKind, metadata, hash, mimeType, request.bytes.byteLength),
    createSignal(request.fileName, 'metadata', {
      format: metadata.format,
      fileName: request.fileName,
      sourceSignalKind: primaryKind,
      byteLength: request.bytes.byteLength,
      hash,
    }, hash, 'application/json', request.bytes.byteLength),
  ];

  return {
    signals,
    diagnosticsJson: JSON.stringify({
      importer: manifest.id,
      version: manifest.version,
      format: metadata.format,
      signalCount: signals.length,
      byteLength: request.bytes.byteLength,
    }),
  };
}
