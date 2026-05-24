import { normalizeSignalMetadata } from '../../signals';
import { createWasmImporterAdapter } from './importerAdapter';
import type {
  WasmCanImportRequest,
  WasmImportRequest,
  WasmImporterAdapter,
  WasmImporterHostOptions,
  WasmImporterHostResult,
  WasmImporterModuleLike,
} from './types';

export type WasmImporterModuleLoader = () => WasmImporterModuleLike | Promise<WasmImporterModuleLike>;

function parseDiagnostics(diagnosticsJson: string) {
  try {
    return normalizeSignalMetadata(JSON.parse(diagnosticsJson));
  } catch {
    return {};
  }
}

export class WasmImporterHost {
  private readonly adapter: WasmImporterAdapter;
  private readonly providerId: string;
  private readonly providerVersion: string | undefined;
  private readonly moduleName: string | undefined;

  constructor(adapter: WasmImporterAdapter, options: WasmImporterHostOptions = {}) {
    this.adapter = adapter;
    this.providerId = options.providerId ?? 'masterselects.wasm.importer';
    this.providerVersion = options.providerVersion;
    this.moduleName = options.moduleName;
  }

  static fromModule(moduleLike: WasmImporterModuleLike, options: WasmImporterHostOptions = {}): WasmImporterHost {
    return new WasmImporterHost(createWasmImporterAdapter(moduleLike), options);
  }

  static async fromLoader(loader: WasmImporterModuleLoader, options: WasmImporterHostOptions = {}): Promise<WasmImporterHost> {
    return WasmImporterHost.fromModule(await loader(), options);
  }

  getProviderId(): string {
    return this.providerId;
  }

  getModuleName(): string | undefined {
    return this.moduleName;
  }

  async canImport(request: WasmCanImportRequest): Promise<boolean> {
    return this.adapter.canImport(request);
  }

  async importFile(request: WasmImportRequest): Promise<WasmImporterHostResult> {
    const result = await this.adapter.importFile(request);

    return {
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      signals: result.signals,
      diagnosticsJson: result.diagnosticsJson,
      diagnostics: parseDiagnostics(result.diagnosticsJson),
    };
  }
}
