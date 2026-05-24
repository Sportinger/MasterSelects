import type { ExtensionProviderManifest } from '../extensions';
import type { RuntimeCapability, RuntimePolicyDecision } from '../runtime/capabilities';
import type { SignalArtifact, SignalAsset, SignalMetadata } from '../signals';
import type { MediaType as LegacyMediaImportType } from '../stores/timeline/helpers/mediaTypeHelpers';

export type UniversalImportRouteKind = 'signal' | 'legacy-media';

export interface SignalImportDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  metadata?: SignalMetadata;
}

export interface SignalImportArtifactPayload {
  artifactId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  artifact: SignalArtifact;
}

export interface SignalImportRequest {
  file: File;
  fileBytes: ArrayBuffer;
  header: Uint8Array;
  assetId: string;
  now: () => string;
  absolutePath?: string;
}

export interface SignalImportProviderResult {
  asset: SignalAsset;
  artifactPayloads: SignalImportArtifactPayload[];
  diagnostics: SignalImportDiagnostic[];
}

export interface BuiltinSignalImportProvider {
  manifest: ExtensionProviderManifest;
  requiredCapabilities: RuntimeCapability[];
  importFile: (request: SignalImportRequest) => Promise<SignalImportProviderResult>;
}

export interface UniversalImportDiscovery {
  fileName: string;
  mimeType: string;
  header: Uint8Array;
  discoveredProviders: ExtensionProviderManifest[];
}

export interface SignalImportPlan {
  route: 'signal';
  file: File;
  provider: ExtensionProviderManifest;
  requiredCapabilities: RuntimeCapability[];
  discovery: UniversalImportDiscovery;
}

export interface LegacyMediaImportPlan {
  route: 'legacy-media';
  file: File;
  legacyMediaType: Exclude<LegacyMediaImportType, 'unknown'>;
  discovery: UniversalImportDiscovery;
}

export type UniversalImportPlan = SignalImportPlan | LegacyMediaImportPlan;

export interface SignalUniversalImportResult {
  route: 'signal';
  provider: ExtensionProviderManifest;
  requiredCapabilities: RuntimeCapability[];
  policyDecision: RuntimePolicyDecision;
  asset: SignalAsset;
  artifactPayloads: SignalImportArtifactPayload[];
  diagnostics: SignalImportDiagnostic[];
  discovery: UniversalImportDiscovery;
}

export interface LegacyUniversalImportResult {
  route: 'legacy-media';
  legacyMediaType: Exclude<LegacyMediaImportType, 'unknown'>;
  discovery: UniversalImportDiscovery;
}

export type UniversalImportResult = SignalUniversalImportResult | LegacyUniversalImportResult;

export type LegacyMediaClassifier = (file: File) => Promise<LegacyMediaImportType>;
