import { ExtensionRegistry, type ExtensionProviderManifest } from '../extensions';
import { classifyMediaType } from '../stores/timeline/helpers/mediaTypeHelpers';
import { createSignalAssetId, guessMimeType, readBlobAsArrayBuffer, readFileRangeAsArrayBuffer } from './fileIdentity';
import { sha256ArrayBuffer } from './hash';
import {
  builtinBinaryFallbackImporter,
  BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
  builtinCsvImporter,
} from './providers';
import type {
  BuiltinSignalImportProvider,
  LegacyMediaClassifier,
  SignalImportPlan,
  UniversalImportPlan,
  UniversalImportResult,
} from './types';

export interface UniversalImportOrchestratorOptions {
  registry?: ExtensionRegistry;
  providers?: BuiltinSignalImportProvider[];
  legacyClassifier?: LegacyMediaClassifier;
  headerBytes?: number;
  now?: () => string;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function providerPriority(provider: ExtensionProviderManifest): number {
  const priority = provider.metadata?.importPriority;
  return typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;
}

function isFallbackProvider(provider: ExtensionProviderManifest): boolean {
  return provider.metadata?.fallback === true || provider.id === BUILTIN_BINARY_FALLBACK_IMPORTER_ID;
}

function sortProviders(providers: ExtensionProviderManifest[]): ExtensionProviderManifest[] {
  return providers.toSorted((left, right) => providerPriority(right) - providerPriority(left));
}

export class UniversalImportOrchestrator {
  private readonly registry: ExtensionRegistry;
  private readonly providers = new Map<string, BuiltinSignalImportProvider>();
  private readonly legacyClassifier: LegacyMediaClassifier;
  private readonly headerBytes: number;
  private readonly now: () => string;

  constructor(options: UniversalImportOrchestratorOptions = {}) {
    this.registry = options.registry ?? new ExtensionRegistry();
    this.legacyClassifier = options.legacyClassifier ?? classifyMediaType;
    this.headerBytes = options.headerBytes ?? 512;
    this.now = options.now ?? defaultNow;

    [
      builtinCsvImporter,
      builtinBinaryFallbackImporter,
      ...(options.providers ?? []),
    ].forEach((provider) => this.registerBuiltinProvider(provider));
  }

  registerBuiltinProvider(provider: BuiltinSignalImportProvider): void {
    if (!this.registry.get(provider.manifest.id)) {
      this.registry.register(provider.manifest);
    }
    this.providers.set(provider.manifest.id, provider);
  }

  getRegistry(): ExtensionRegistry {
    return this.registry;
  }

  async planImport(file: File): Promise<UniversalImportPlan> {
    const header = new Uint8Array(await readFileRangeAsArrayBuffer(file, 0, this.headerBytes));
    const discoveredProviders = sortProviders(this.registry.findImportersForFile({
      fileName: file.name,
      mimeType: guessMimeType(file, file.type),
      header,
    }));
    const discovery = {
      fileName: file.name,
      mimeType: guessMimeType(file),
      header,
      discoveredProviders,
    };

    const concreteSignalProvider = discoveredProviders.find((provider) => (
      !isFallbackProvider(provider) && this.providers.has(provider.id)
    ));
    if (concreteSignalProvider) {
      return {
        route: 'signal',
        file,
        provider: concreteSignalProvider,
        requiredCapabilities: this.providers.get(concreteSignalProvider.id)!.requiredCapabilities,
        discovery,
      };
    }

    const legacyMediaType = await this.legacyClassifier(file);
    if (legacyMediaType !== 'unknown') {
      return {
        route: 'legacy-media',
        file,
        legacyMediaType,
        discovery,
      };
    }

    const fallbackProvider = discoveredProviders.find((provider) => (
      isFallbackProvider(provider) && this.providers.has(provider.id)
    ));
    if (!fallbackProvider) {
      throw new Error(`No universal importer available for "${file.name}"`);
    }

    return {
      route: 'signal',
      file,
      provider: fallbackProvider,
      requiredCapabilities: this.providers.get(fallbackProvider.id)!.requiredCapabilities,
      discovery,
    };
  }

  async importFile(file: File, options: { absolutePath?: string } = {}): Promise<UniversalImportResult> {
    const plan = await this.planImport(file);
    return this.importPlannedFile(plan, options);
  }

  async importPlannedFile(
    plan: UniversalImportPlan,
    options: { absolutePath?: string } = {},
  ): Promise<UniversalImportResult> {
    if (plan.route === 'legacy-media') {
      return {
        route: 'legacy-media',
        legacyMediaType: plan.legacyMediaType,
        discovery: plan.discovery,
      };
    }

    return this.importWithSignalProvider(plan, options);
  }

  private async importWithSignalProvider(
    plan: SignalImportPlan,
    options: { absolutePath?: string },
  ): Promise<UniversalImportResult> {
    const provider = this.providers.get(plan.provider.id);
    if (!provider) {
      throw new Error(`No builtin importer implementation registered for "${plan.provider.id}"`);
    }

    const policyDecision = this.registry.checkProviderCapabilities(
      plan.provider.id,
      provider.requiredCapabilities,
    );
    if (!policyDecision.allowed) {
      throw new Error(policyDecision.reason);
    }

    const fileBytes = await readBlobAsArrayBuffer(plan.file);
    const contentHash = await sha256ArrayBuffer(fileBytes);
    const assetId = createSignalAssetId(plan.file, contentHash);
    const result = await provider.importFile({
      file: plan.file,
      fileBytes,
      header: plan.discovery.header,
      assetId,
      now: this.now,
      absolutePath: options.absolutePath,
    });

    return {
      route: 'signal',
      provider: plan.provider,
      requiredCapabilities: provider.requiredCapabilities,
      policyDecision,
      asset: result.asset,
      artifactPayloads: result.artifactPayloads,
      diagnostics: result.diagnostics,
      discovery: plan.discovery,
    };
  }
}

export function createDefaultUniversalImportOrchestrator(
  options: UniversalImportOrchestratorOptions = {},
): UniversalImportOrchestrator {
  return new UniversalImportOrchestrator(options);
}
