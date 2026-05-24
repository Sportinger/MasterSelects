import {
  SIGNAL_KINDS,
  SIGNAL_RUNTIME_KINDS,
  SIGNAL_SCHEMA_VERSION,
  type JsonValue,
  type SignalArtifact,
  type SignalAsset,
  type SignalGraph,
  type SignalKind,
  type SignalMetadata,
  type SignalOperatorDescriptor,
  type SignalRef,
  type SignalRuntimeKind,
} from './types';

type AnyRecord = Record<string, unknown>;

const SIGNAL_KIND_SET = new Set<string>(SIGNAL_KINDS);
const SIGNAL_RUNTIME_KIND_SET = new Set<string>(SIGNAL_RUNTIME_KINDS);

function isRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

export function isSignalMetadata(value: unknown): value is SignalMetadata {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function isSignalKind(value: unknown): value is SignalKind {
  return typeof value === 'string' && SIGNAL_KIND_SET.has(value);
}

export function isSignalRuntimeKind(value: unknown): value is SignalRuntimeKind {
  return typeof value === 'string' && SIGNAL_RUNTIME_KIND_SET.has(value);
}

export function isSignalArtifact(value: unknown): value is SignalArtifact {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SIGNAL_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(value.artifactId)) return false;
  if (!isNonEmptyString(value.hash)) return false;
  if (!isFiniteNonNegativeNumber(value.size)) return false;
  if (!isNonEmptyString(value.mimeType)) return false;
  if (!isNonEmptyString(value.encoding)) return false;
  if (!isRecord(value.storage) || !isNonEmptyString(value.storage.kind)) return false;
  if (!isRecord(value.producer) || !isNonEmptyString(value.producer.providerId)) return false;
  if (!isStringArray(value.sourceRefs)) return false;
  if (!isNonEmptyString(value.createdAt)) return false;

  if (value.byteRange !== undefined) {
    if (!isRecord(value.byteRange)) return false;
    if (!isFiniteNonNegativeNumber(value.byteRange.offset)) return false;
    if (!isFiniteNonNegativeNumber(value.byteRange.length)) return false;
  }

  return value.metadata === undefined || isSignalMetadata(value.metadata);
}

export function isSignalRef(value: unknown): value is SignalRef {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SIGNAL_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isSignalKind(value.kind)) return false;
  if (!isNonEmptyString(value.createdAt)) return false;
  return value.metadata === undefined || isSignalMetadata(value.metadata);
}

export function isSignalAsset(value: unknown): value is SignalAsset {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SIGNAL_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (!isRecord(value.source) || !isNonEmptyString(value.source.kind)) return false;
  if (!Array.isArray(value.refs) || !value.refs.every(isSignalRef)) return false;
  if (!Array.isArray(value.artifacts) || !value.artifacts.every(isSignalArtifact)) return false;
  if (!isNonEmptyString(value.createdAt)) return false;
  return value.metadata === undefined || isSignalMetadata(value.metadata);
}

export function isSignalOperatorDescriptor(value: unknown): value is SignalOperatorDescriptor {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SIGNAL_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.version)) return false;
  if (!isNonEmptyString(value.label)) return false;
  if (!isNonEmptyString(value.role)) return false;
  if (!isSignalRuntimeKind(value.runtime)) return false;
  if (!Array.isArray(value.inputs) || !Array.isArray(value.outputs)) return false;

  const isPort = (port: unknown) => (
    isRecord(port) &&
    isNonEmptyString(port.id) &&
    isNonEmptyString(port.label) &&
    isSignalKind(port.kind) &&
    (port.metadata === undefined || isSignalMetadata(port.metadata))
  );

  return value.inputs.every(isPort) &&
    value.outputs.every(isPort) &&
    (value.metadata === undefined || isSignalMetadata(value.metadata));
}

export function isSignalGraph(value: unknown): value is SignalGraph {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== SIGNAL_SCHEMA_VERSION) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!Array.isArray(value.nodes)) return false;
  if (!Array.isArray(value.edges)) return false;
  if (!Array.isArray(value.outputs) || !value.outputs.every(isSignalRef)) return false;
  if (!isNonEmptyString(value.createdAt)) return false;
  return value.metadata === undefined || isSignalMetadata(value.metadata);
}

export function normalizeSignalMetadata(value: unknown): SignalMetadata {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<SignalMetadata>((metadata, [key, entry]) => {
    if (isJsonValue(entry)) {
      metadata[key] = entry;
    }
    return metadata;
  }, {});
}
