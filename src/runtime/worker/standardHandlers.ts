import type {
  RuntimeJobHandler,
  RuntimeJobHandlerRegistration,
} from './types';
import { createRuntimeTransferList } from './transferables';

export interface RuntimeHashJobInput {
  bytes: ArrayBuffer | ArrayBufferView;
  algorithm?: 'SHA-256';
}

export interface RuntimeHashJobOutput {
  algorithm: 'SHA-256';
  hash: string;
  byteLength: number;
}

export interface RuntimeCsvInspectJobInput {
  bytes?: ArrayBuffer | ArrayBufferView;
  text?: string;
  delimiter?: string;
  hasHeader?: boolean;
  sampleLimit?: number;
}

export interface RuntimeCsvInspectJobOutput {
  delimiter: string;
  hasHeader: boolean;
  columnCount: number;
  rowCount: number;
  columns: string[];
  sampleRows: string[][];
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Runtime job cancelled', 'AbortError');
  }
}

function bytesToArrayBuffer(bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return copy.buffer;
}

function bytesToText(bytes: ArrayBuffer | ArrayBufferView): string {
  return new TextDecoder().decode(bytesToArrayBuffer(bytes));
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((cellValue) => cellValue.trim().length > 0));
}

export const runtimeEchoHandler: RuntimeJobHandler = (input, context) => {
  context.log('debug', 'Echo runtime job started');
  context.progress({ value: 1, stage: 'echo', message: 'Echo payload returned' });
  return {
    output: input,
    transfer: createRuntimeTransferList(input),
  };
};

export const runtimeSha256Handler: RuntimeJobHandler<RuntimeHashJobInput, RuntimeHashJobOutput> = async (
  input,
  context,
) => {
  assertNotAborted(context.signal);
  context.log('debug', 'SHA-256 runtime job started');
  context.progress({ value: 0.1, stage: 'hash', message: 'Reading bytes' });

  const bytes = bytesToArrayBuffer(input.bytes);
  context.progress({ value: 0.5, stage: 'hash', message: 'Hashing bytes' });
  const digest = await crypto.subtle.digest(input.algorithm ?? 'SHA-256', bytes);

  assertNotAborted(context.signal);
  const output = {
    algorithm: 'SHA-256' as const,
    hash: `sha256:${hex(digest)}`,
    byteLength: bytes.byteLength,
  };
  context.progress({ value: 1, stage: 'hash', message: 'Hash complete' });
  return { output };
};

export const runtimeCsvInspectHandler: RuntimeJobHandler<
  RuntimeCsvInspectJobInput,
  RuntimeCsvInspectJobOutput
> = (input, context) => {
  assertNotAborted(context.signal);
  context.log('debug', 'CSV inspect runtime job started');
  context.progress({ value: 0.2, stage: 'csv', message: 'Decoding text' });

  const text = input.text ?? (input.bytes ? bytesToText(input.bytes) : '');
  const delimiter = input.delimiter ?? ',';
  if (delimiter.length !== 1) {
    throw new Error('CSV delimiter must be a single character');
  }

  context.progress({ value: 0.6, stage: 'csv', message: 'Parsing rows' });
  const rows = parseCsvRows(text, delimiter);
  const hasHeader = input.hasHeader ?? true;
  const header = hasHeader ? rows[0] ?? [] : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const columnCount = Math.max(header.length, ...dataRows.map((row) => row.length), 0);
  const columns = hasHeader && header.length > 0
    ? header.map((name, index) => name || `column_${index + 1}`)
    : Array.from({ length: columnCount }, (_value, index) => `column_${index + 1}`);

  if (dataRows.length === 0) {
    context.diagnostic('warning', 'csv.empty', 'CSV input contains no data rows');
  }

  assertNotAborted(context.signal);
  context.progress({ value: 1, stage: 'csv', message: 'CSV inspected' });
  return {
    output: {
      delimiter,
      hasHeader,
      columnCount,
      rowCount: dataRows.length,
      columns,
      sampleRows: dataRows.slice(0, input.sampleLimit ?? 5),
    },
  };
};

export const STANDARD_RUNTIME_WORKER_HANDLERS: RuntimeJobHandlerRegistration[] = [
  { handlerId: 'runtime.echo', handler: runtimeEchoHandler },
  { handlerId: 'runtime.hash.sha256', handler: runtimeSha256Handler },
  { handlerId: 'runtime.csv.inspect', handler: runtimeCsvInspectHandler },
];
