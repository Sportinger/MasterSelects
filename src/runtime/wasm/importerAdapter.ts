import { isSignalKind, normalizeSignalMetadata } from '../../signals';
import type {
  WasmArtifactRef,
  WasmCanImportRequest,
  WasmImportRequest,
  WasmImportResult,
  WasmImporterAdapter,
  WasmImporterExports,
  WasmImporterModuleLike,
  WasmImporterResultLike,
  WasmSignalRef,
} from './types';

type AnyRecord = Record<string, unknown>;
type RawImporterFunction = (...args: unknown[]) => unknown;

const IMPORTER_EXPORT_KEYS = [
  'importer',
  'masterselectsImporter',
  'masterselects-importer',
  'masterselects:runtime/importer',
  'masterselects:runtime@0.1.0/importer',
  'default',
] as const;

function isRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFunction(value: unknown): value is RawImporterFunction {
  return typeof value === 'function';
}

function getFunction(record: AnyRecord, camelName: string, kebabName: string): RawImporterFunction | undefined {
  const value = record[camelName] ?? record[kebabName];
  return isFunction(value) ? value : undefined;
}

function toUint8Array(value: ArrayLike<number> | ArrayBufferLike | undefined): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (
    value instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)
  ) {
    return new Uint8Array(value);
  }

  return Uint8Array.from(value as ArrayLike<number>);
}

function readString(record: AnyRecord, camelName: string, kebabName = camelName): string | undefined {
  const value = record[camelName] ?? record[kebabName];
  return typeof value === 'string' ? value : undefined;
}

function readSize(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Wasm importer artifact size exceeds Number.MAX_SAFE_INTEGER: ${value.toString()}`);
    }
    return Number(value);
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  throw new Error('Wasm importer artifact size must be a non-negative safe integer');
}

function normalizeArtifactRef(raw: unknown): WasmArtifactRef | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!isRecord(raw)) {
    throw new Error('Wasm importer signal artifact must be an object');
  }

  const id = readString(raw, 'id');
  const hash = readString(raw, 'hash');
  const mimeType = readString(raw, 'mimeType', 'mime-type');
  if (!id || !hash || !mimeType) {
    throw new Error('Wasm importer artifact is missing id, hash, or mimeType');
  }

  return {
    id,
    hash,
    mimeType,
    size: readSize(raw.size),
  };
}

function normalizeMetadataJson(raw: AnyRecord): string {
  const metadataJson = readString(raw, 'metadataJson', 'metadata-json');
  if (metadataJson !== undefined) {
    try {
      JSON.parse(metadataJson);
    } catch (error) {
      throw new Error(`Wasm importer returned invalid metadataJson: ${error instanceof Error ? error.message : String(error)}`);
    }
    return metadataJson;
  }

  const metadata = raw.metadata;
  if (metadata === undefined) {
    return '{}';
  }

  return JSON.stringify(normalizeSignalMetadata(metadata));
}

function normalizeSignalRef(raw: unknown): WasmSignalRef {
  if (!isRecord(raw)) {
    throw new Error('Wasm importer signal must be an object');
  }

  const id = readString(raw, 'id');
  const kind = readString(raw, 'kind');
  if (!id || !isSignalKind(kind)) {
    throw new Error(`Wasm importer returned invalid signal ref: ${id ?? '<missing id>'}`);
  }

  return {
    id,
    kind,
    artifact: normalizeArtifactRef(raw.artifact),
    metadataJson: normalizeMetadataJson(raw),
  };
}

function normalizeImportResult(raw: unknown): WasmImportResult {
  if (!isRecord(raw)) {
    throw new Error('Wasm importer importFile result must be an object');
  }

  const rawSignals = raw.signals;
  if (!Array.isArray(rawSignals)) {
    throw new Error('Wasm importer importFile result is missing a signals array');
  }

  return {
    signals: rawSignals.map(normalizeSignalRef),
    diagnosticsJson: readString(raw, 'diagnosticsJson', 'diagnostics-json') ?? '{}',
  };
}

function unwrapWitResult(raw: WasmImporterResultLike): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  if ('tag' in raw) {
    if (raw.tag === 'ok') {
      return raw.val;
    }
    if (raw.tag === 'err') {
      throw new Error(`Wasm importer failed: ${String(raw.val)}`);
    }
  }

  if ('ok' in raw) {
    return raw.ok;
  }

  if ('err' in raw) {
    throw new Error(`Wasm importer failed: ${String(raw.err)}`);
  }

  return raw;
}

export function resolveWasmImporterExports(moduleLike: WasmImporterModuleLike): WasmImporterExports {
  const seen = new Set<unknown>();
  const queue: unknown[] = [moduleLike];

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!isRecord(candidate) || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const canImport = getFunction(candidate, 'canImport', 'can-import');
    const importFile = getFunction(candidate, 'importFile', 'import-file');
    if (canImport && importFile) {
      return {
        canImport: (fileName, mimeType, header) => Promise.resolve(canImport(fileName, mimeType, header) as boolean),
        importFile: (request) => Promise.resolve(importFile(request) as WasmImporterResultLike),
      };
    }

    for (const key of IMPORTER_EXPORT_KEYS) {
      if (key in candidate) {
        queue.push(candidate[key]);
      }
    }
  }

  throw new Error('Wasm importer module does not export canImport/importFile');
}

export function createWasmImporterAdapter(moduleLike: WasmImporterModuleLike): WasmImporterAdapter {
  const exports = resolveWasmImporterExports(moduleLike);

  return {
    async canImport(request: WasmCanImportRequest): Promise<boolean> {
      return Boolean(await exports.canImport(
        request.fileName,
        request.mimeType ?? '',
        toUint8Array(request.header),
      ));
    },

    async importFile(request: WasmImportRequest): Promise<WasmImportResult> {
      const result = await exports.importFile({
        ...request,
        bytes: toUint8Array(request.bytes),
      });

      return normalizeImportResult(unwrapWitResult(result));
    },
  };
}
