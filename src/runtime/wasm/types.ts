import type { SignalKind, SignalMetadata } from '../../signals';

export const WASM_IMPORTER_ABI_PACKAGE = 'masterselects:runtime@0.1.0' as const;
export const WASM_IMPORTER_WORLD = 'masterselects-importer' as const;

export type WasmSignalKind = SignalKind;

export interface WasmArtifactRef {
  id: string;
  hash: string;
  mimeType: string;
  size: number;
}

export interface WasmSignalRef {
  id: string;
  kind: WasmSignalKind;
  artifact?: WasmArtifactRef;
  metadataJson: string;
}

export interface WasmImportRequest {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface WasmImportResult {
  signals: WasmSignalRef[];
  diagnosticsJson: string;
}

export type WasmImporterResultLike =
  | WasmImportResult
  | { tag: 'ok'; val: unknown }
  | { tag: 'err'; val: unknown }
  | { ok: unknown }
  | { err: unknown };

export type MaybePromise<T> = T | Promise<T>;

export interface WasmImporterExports {
  canImport(fileName: string, mimeType: string, header: Uint8Array): MaybePromise<boolean>;
  importFile(request: WasmImportRequest): MaybePromise<WasmImporterResultLike>;
}

export type WasmImporterModuleLike = WasmImporterExports | Record<string, unknown>;

export interface WasmCanImportRequest {
  fileName: string;
  mimeType?: string;
  header?: ArrayLike<number> | ArrayBufferLike;
}

export interface WasmImporterHostOptions {
  providerId?: string;
  providerVersion?: string;
  moduleName?: string;
}

export interface WasmImporterHostResult {
  providerId: string;
  providerVersion?: string;
  signals: WasmSignalRef[];
  diagnosticsJson: string;
  diagnostics: SignalMetadata;
}

export interface WasmImporterAdapter {
  canImport(request: WasmCanImportRequest): Promise<boolean>;
  importFile(request: WasmImportRequest): Promise<WasmImportResult>;
}
