import {
  AUDIO_GRAPH_SCHEMA_VERSION,
  type AudioGraphDescriptor,
  type AudioGraphJsonPrimitive,
  type AudioGraphJsonValue,
  type AudioGraphRenderInput,
} from '../AudioGraphTypes';

export const AUDIO_GRAPH_PAYLOAD_FIELD_NAMES = Object.freeze([
  'audioBuffer',
  'buffer',
  'buffers',
  'file',
  'manifestRef',
  'payloadBytes',
  'payloadRefs',
  'rawBytes',
  'rawSamples',
  'renderedBuffer',
  'sampleData',
  'samples',
  'source',
  'thumbnails',
  'videoElement',
  'waveform',
]);

export const PAYLOAD_FIELD_NAMES = new Set<string>(AUDIO_GRAPH_PAYLOAD_FIELD_NAMES);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonPrimitive(value: unknown): value is AudioGraphJsonPrimitive {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  return typeof value === 'number' && Number.isFinite(value);
}

export function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function normalizeGraphJsonValue(value: unknown): AudioGraphJsonValue | undefined {
  if (isJsonPrimitive(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(entry => normalizeGraphJsonValue(entry))
      .filter((entry): entry is AudioGraphJsonValue => entry !== undefined);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const normalized: Record<string, AudioGraphJsonValue> = {};
  for (const key of Object.keys(value).toSorted()) {
    if (PAYLOAD_FIELD_NAMES.has(key)) {
      continue;
    }

    const nested = normalizeGraphJsonValue(value[key]);
    if (nested !== undefined) {
      normalized[key] = nested;
    }
  }

  return normalized;
}

function canonicalizeJson(value: unknown): AudioGraphJsonValue {
  if (isJsonPrimitive(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => canonicalizeJson(item));
  }

  if (isRecord(value)) {
    const normalized: Record<string, AudioGraphJsonValue> = {};
    for (const key of Object.keys(value).toSorted()) {
      const entry = value[key];
      if (entry !== undefined) {
        normalized[key] = canonicalizeJson(entry);
      }
    }
    return normalized;
  }

  return null;
}

function stableJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function hashString(input: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(36).padStart(7, '0');
}

export function descriptorKey(descriptor: AudioGraphDescriptor): string {
  const json = stableJsonString(descriptor);
  return `audio-graph:v${AUDIO_GRAPH_SCHEMA_VERSION}:${hashString(json)}:${json.length}`;
}

export function isAudioGraphDescriptor(value: AudioGraphDescriptor | AudioGraphRenderInput): value is AudioGraphDescriptor {
  return isRecord(value) && value.schemaVersion === AUDIO_GRAPH_SCHEMA_VERSION && isRecord(value.master);
}
