import type { SignalKind, SignalMetadata, SignalProviderRole, SignalRuntimeKind } from '../signals';
import type { RuntimeCapability } from '../runtime/capabilities';

export interface ExtensionFileSignature {
  extensions?: string[];
  mimeTypes?: string[];
  headerBytes?: number[];
}

export interface ExtensionSignalSignature {
  inputKinds?: SignalKind[];
  outputKinds?: SignalKind[];
}

export interface ExtensionEntrypoint {
  module: string;
  exportName?: string;
}

export interface ExtensionProviderManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  displayName: string;
  role: SignalProviderRole;
  runtime: SignalRuntimeKind;
  capabilities: RuntimeCapability[];
  fileSignatures?: ExtensionFileSignature[];
  signals?: ExtensionSignalSignature;
  entrypoint?: ExtensionEntrypoint;
  metadata?: SignalMetadata;
}

export interface ExtensionProviderQuery {
  role?: SignalProviderRole;
  runtime?: SignalRuntimeKind;
  inputKind?: SignalKind;
  outputKind?: SignalKind;
  capability?: RuntimeCapability;
}

export interface ExtensionFileQuery {
  fileName: string;
  mimeType?: string;
  header?: ArrayLike<number>;
}
