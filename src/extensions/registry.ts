import { checkRuntimeCapabilities, normalizeRuntimeCapabilities, type RuntimeCapability } from '../runtime/capabilities';
import { SIGNAL_SCHEMA_VERSION, type SignalKind } from '../signals';
import type {
  ExtensionFileQuery,
  ExtensionFileSignature,
  ExtensionProviderManifest,
  ExtensionProviderQuery,
} from './types';

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, '').trim().toLowerCase();
}

function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? '';
}

function normalizeMimeType(mimeType?: string): string {
  return (mimeType ?? '').split(';')[0].trim().toLowerCase();
}

function headerMatches(expected: number[] | undefined, header: ArrayLike<number> | undefined): boolean {
  if (!expected || expected.length === 0) {
    return true;
  }
  if (!header || header.length < expected.length) {
    return false;
  }
  return expected.every((byte, index) => header[index] === byte);
}

function fileSignatureMatches(signature: ExtensionFileSignature, query: ExtensionFileQuery): boolean {
  const extension = getFileExtension(query.fileName);
  const mimeType = normalizeMimeType(query.mimeType);
  const extensionMatches = !signature.extensions?.length ||
    signature.extensions.map(normalizeExtension).includes(extension);
  const mimeMatches = !signature.mimeTypes?.length ||
    signature.mimeTypes.map(normalizeMimeType).includes(mimeType);
  return extensionMatches && mimeMatches && headerMatches(signature.headerBytes, query.header);
}

function kindMatches(kinds: SignalKind[] | undefined, kind: SignalKind | undefined): boolean {
  return kind === undefined || kinds?.includes(kind) === true;
}

export class ExtensionRegistry {
  private readonly providers = new Map<string, ExtensionProviderManifest>();

  constructor(providers: ExtensionProviderManifest[] = []) {
    providers.forEach((provider) => this.register(provider));
  }

  register(provider: ExtensionProviderManifest): void {
    if (provider.schemaVersion !== SIGNAL_SCHEMA_VERSION) {
      throw new Error(`Unsupported extension manifest schema: ${provider.id}`);
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`Extension provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, {
      ...provider,
      capabilities: normalizeRuntimeCapabilities(provider.capabilities),
      fileSignatures: provider.fileSignatures?.map((signature) => ({
        ...signature,
        extensions: signature.extensions?.map(normalizeExtension),
        mimeTypes: signature.mimeTypes?.map(normalizeMimeType),
      })),
    });
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  get(providerId: string): ExtensionProviderManifest | undefined {
    return this.providers.get(providerId);
  }

  list(): ExtensionProviderManifest[] {
    return [...this.providers.values()];
  }

  findProviders(query: ExtensionProviderQuery = {}): ExtensionProviderManifest[] {
    return this.list().filter((provider) => {
      if (query.role && provider.role !== query.role) return false;
      if (query.runtime && provider.runtime !== query.runtime) return false;
      if (query.capability && !provider.capabilities.includes(query.capability)) return false;
      if (!kindMatches(provider.signals?.inputKinds, query.inputKind)) return false;
      return kindMatches(provider.signals?.outputKinds, query.outputKind);
    });
  }

  findImportersForFile(query: ExtensionFileQuery): ExtensionProviderManifest[] {
    return this.findProviders({ role: 'importer' }).filter((provider) => (
      provider.fileSignatures?.some((signature) => fileSignatureMatches(signature, query)) === true
    ));
  }

  checkProviderCapabilities(providerId: string, requested: RuntimeCapability[]) {
    const provider = this.providers.get(providerId);
    return checkRuntimeCapabilities(
      provider
        ? { providerId, granted: provider.capabilities }
        : undefined,
      { providerId, requested },
    );
  }
}
