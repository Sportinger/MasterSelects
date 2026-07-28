import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineArtifactRef,
  type AgentTimelineChannel,
  type AgentTimelineEvent,
  type AgentTimelineManifest,
} from '../../../types/agentTimeline/manifest';
import { isValidHalfOpenRange } from './eventSemantics';

const MAX_EVENT_TEXT_LENGTH = 16 * 1024;
const MAX_EVENT_LIST_ITEMS = 512;
const REQUIRED_CHANNELS = [
  'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
  'camera-motion', 'audio', 'quality', 'text', 'duplicates',
] as const;

const CHANNEL_EVENT_TYPES = {
  cuts: ['cut'], shots: ['shot'], scenes: ['scene-block'], speech: ['speech', 'speech-marker'],
  people: ['person-visible'], 'active-speaker': ['active-speaker'],
  'camera-motion': ['camera-motion'], audio: ['audio-activity'], quality: ['quality-issue'],
  text: ['onscreen-text'], duplicates: ['duplicate-group'],
} as const satisfies Record<string, readonly AgentTimelineEvent['type'][]>;

const EVENT_TYPES = new Set<AgentTimelineEvent['type']>([
  'cut', 'shot', 'scene-block', 'speech', 'speech-marker', 'person-visible', 'active-speaker',
  'camera-motion', 'audio-activity', 'quality-issue', 'onscreen-text', 'duplicate-group',
]);
const TIME_DOMAINS = new Set(['source', 'clip-rendered', 'composition-rendered']);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function oneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function canonicalTimestamp(value: unknown): boolean {
  if (!nonEmpty(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validStringList(value: unknown, maximum: number): boolean {
  return Array.isArray(value) && value.length <= maximum && value.every(item => nonEmpty(item));
}

/** The durable channel contract. Callers can reject mismatched shard payloads before publishing. */
export function isEventTypeAllowedForChannel(channel: AgentTimelineChannel, eventType: unknown): boolean {
  return typeof eventType === 'string'
    && (CHANNEL_EVENT_TYPES[channel] as readonly string[]).includes(eventType);
}

function isNormalizedBox(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const box = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((key) => typeof box[key] === 'number' && Number.isFinite(box[key]))
    && Number(box.x) >= 0 && Number(box.y) >= 0 && Number(box.width) >= 0 && Number(box.height) >= 0
    && Number(box.x) + Number(box.width) <= 1 && Number(box.y) + Number(box.height) <= 1;
}

function findNonSerializable(value: unknown, path = 'root', seen = new WeakSet<object>()): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : `${path} contains a non-finite number`;
  if (typeof value !== 'object') return `${path} contains ${typeof value}`;
  if (seen.has(value)) return `${path} contains a cycle`;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const error = findNonSerializable(value[index], `${path}[${index}]`, seen);
      if (error) return error;
    }
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return `${path} contains a runtime object`;
  for (const [key, entry] of Object.entries(value)) {
    const error = findNonSerializable(entry, `${path}.${key}`, seen);
    if (error) return error;
  }
  return undefined;
}

export function validateArtifactRef(artifact: AgentTimelineArtifactRef): string[] {
  const errors: string[] = [];
  if (!nonEmpty(artifact.artifactRef)) errors.push('artifactRef is required');
  if (!nonEmpty(artifact.shardId)) errors.push('shardId is required');
  if (!nonEmpty(artifact.schemaVersion)) errors.push('artifact schemaVersion is required');
  if (!nonEmpty(artifact.analyzerId) || !nonEmpty(artifact.analyzerVersion)) errors.push('analyzer id/version are required');
  if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) errors.push('artifact byteLength must be non-negative');
  if (!Array.isArray(artifact.eventTypes) || artifact.eventTypes.length === 0) errors.push('artifact eventTypes are required');
  else if (artifact.eventTypes.some((type) => !EVENT_TYPES.has(type))) errors.push('artifact eventTypes contain an unsupported type');
  if (artifact.timeDomain === 'source' && artifact.stateHash !== undefined) errors.push('source artifacts must not carry stateHash');
  if (artifact.timeDomain !== 'source' && !nonEmpty(artifact.stateHash)) errors.push('rendered artifacts require stateHash');
  if (artifact.coverage.some((range) => !isValidHalfOpenRange(range))) errors.push('artifact coverage must use valid half-open ranges');
  return errors;
}

export function validateAgentTimelineManifest(manifest: AgentTimelineManifest): string[] {
  const errors: string[] = [];
  const serializationError = findNonSerializable(manifest);
  if (serializationError) errors.push(serializationError);
  if (manifest.schemaVersion !== AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION) errors.push('unsupported manifest schemaVersion');
  if (!nonEmpty(manifest.mediaFileId)) errors.push('mediaFileId is required');
  if (!Number.isFinite(manifest.durationSeconds) || manifest.durationSeconds <= 0) errors.push('durationSeconds must be positive');
  if (Number.isNaN(Date.parse(manifest.generatedAt))) errors.push('generatedAt must be an ISO-compatible timestamp');
  for (const channel of REQUIRED_CHANNELS) {
    if (!manifest.channels[channel]) errors.push(`missing channel ${channel}`);
  }
  for (const [channel, channelManifest] of Object.entries(manifest.channels)) {
    if (!channelManifest || !Array.isArray(channelManifest.artifacts)) {
      errors.push(`channel ${channel} needs artifacts`);
      continue;
    }
    for (const artifact of channelManifest.artifacts) {
      errors.push(...validateArtifactRef(artifact).map((error) => `${channel}: ${error}`));
      if (!(channel in CHANNEL_EVENT_TYPES)) {
        errors.push(`unsupported channel ${channel}`);
      } else if (artifact.eventTypes.some((type) => !isEventTypeAllowedForChannel(channel as AgentTimelineChannel, type))) {
        errors.push(`${channel}: artifact eventTypes do not match the channel`);
      }
    }
  }
  return errors;
}

export function validateAgentTimelineEvent(event: AgentTimelineEvent): string[] {
  const errors: string[] = [];
  if (!record(event)) return ['event must be an object'];
  const serializationError = findNonSerializable(event);
  if (serializationError) errors.push(serializationError);
  if (event.schemaVersion !== AGENT_TIMELINE_EVENT_SCHEMA_VERSION) errors.push('unsupported event schemaVersion');
  if (!nonEmpty(event.id)) errors.push('event id is required');
  if (!EVENT_TYPES.has(event.type)) errors.push('unsupported event type');
  if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1) errors.push('confidence must be between 0 and 1');
  validateProvenance(event.provenance, errors);
  validateEventTime(event.time, errors);
  if (event.keyframeSourceTime !== undefined && (!finite(event.keyframeSourceTime) || event.keyframeSourceTime < 0)) {
    errors.push('keyframeSourceTime must be a non-negative finite number');
  }
  validateEventData(event.type, event.data, errors);
  if ((event.type === 'person-visible' || event.type === 'onscreen-text') && record(event.data) && event.data.box && !isNormalizedBox(event.data.box)) {
    errors.push('box must be normalized inside the frame');
  }
  return errors;
}

function validateProvenance(provenance: unknown, errors: string[]): void {
  if (!Array.isArray(provenance) || provenance.length === 0) {
    errors.push('provenance is required');
    return;
  }
  for (const entry of provenance) {
    if (!record(entry)) { errors.push('provenance entries must be objects'); continue; }
    if (entry.kind === 'analyzer') {
      if (!nonEmpty(entry.analyzerId) || !nonEmpty(entry.analyzerVersion)) errors.push('analyzer provenance requires id/version');
      if ((entry.modelId === undefined) !== (entry.modelVersion === undefined)) errors.push('analyzer model id/version must be paired');
      if (entry.modelId !== undefined && (!nonEmpty(entry.modelId) || !nonEmpty(entry.modelVersion))) errors.push('analyzer model id/version must be non-empty');
      if (entry.artifactRef !== undefined && !nonEmpty(entry.artifactRef)) errors.push('analyzer artifactRef must be non-empty');
    } else if (entry.kind === 'manual') {
      if (!nonEmpty(entry.annotationId) || !canonicalTimestamp(entry.createdAt)) errors.push('manual provenance requires annotationId and canonical createdAt');
    } else {
      errors.push('unsupported provenance kind');
    }
  }
}

function validateEventTime(time: unknown, errors: string[]): void {
  if (!record(time) || !TIME_DOMAINS.has(String(time.timeDomain))) {
    errors.push('event time requires a supported timeDomain');
    return;
  }
  if (time.temporalKind === 'point') {
    if (!finite(time.time) || time.time < 0) errors.push('point time must be a non-negative finite number');
  } else if (time.temporalKind === 'interval') {
    if (!finite(time.start) || !finite(time.end) || time.start < 0 || time.start >= time.end) {
      errors.push('interval time must be a non-negative valid half-open range');
    }
  } else {
    errors.push('event time requires point or interval temporalKind');
  }
  if (time.timeDomain === 'source' && time.stateHash !== undefined) errors.push('source event must not carry stateHash');
  if (time.timeDomain !== 'source' && !nonEmpty(time.stateHash)) errors.push('rendered event requires stateHash');
}

function validateEventData(type: unknown, data: unknown, errors: string[]): void {
  if (!record(data)) { errors.push('event data must be an object'); return; }
  switch (type) {
    case 'cut':
      if (!finite(data.score) || !oneOf(data.transition, ['hard', 'fade', 'dissolve', 'black', 'unknown'])) errors.push('cut data is invalid');
      break;
    case 'shot':
      if (!nonEmpty(data.shotId)) errors.push('shot data requires shotId');
      if (data.index !== undefined && (!finite(data.index) || !Number.isSafeInteger(data.index) || data.index < 0)) errors.push('shot index must be non-negative');
      if (data.setupId !== undefined && !nonEmpty(data.setupId)) errors.push('shot setupId must be non-empty');
      if (data.shotSize !== undefined && !oneOf(data.shotSize, ['extreme-close-up', 'close-up', 'medium', 'medium-wide', 'wide', 'unknown'])) errors.push('shot shotSize is invalid');
      if (data.layout !== undefined && !oneOf(data.layout, ['single', 'two-shot', 'group', 'no-face', 'unknown'])) errors.push('shot layout is invalid');
      break;
    case 'scene-block':
      if (!nonEmpty(data.sceneId) || !oneOf(data.boundarySource, ['rule-based', 'manual', 'shot-fallback']) || !validStringList(data.shotIds, MAX_EVENT_LIST_ITEMS)) errors.push('scene-block data is invalid');
      if (data.setupIds !== undefined && !validStringList(data.setupIds, MAX_EVENT_LIST_ITEMS)) errors.push('scene-block lists are invalid');
      if (data.label !== undefined && !nonEmpty(data.label)) errors.push('scene-block label must be non-empty');
      break;
    case 'speech':
      if (!nonEmpty(data.speakerId)) errors.push('speech data requires speakerId');
      if (data.text !== undefined && (typeof data.text !== 'string' || data.text.length > MAX_EVENT_TEXT_LENGTH)) errors.push('speech text is invalid');
      if (data.language !== undefined && !nonEmpty(data.language)) errors.push('speech language must be non-empty');
      if (data.wordCount !== undefined && (!finite(data.wordCount) || !Number.isSafeInteger(data.wordCount) || data.wordCount < 0)) errors.push('speech wordCount must be non-negative');
      if (data.emphasis !== undefined && (!finite(data.emphasis) || data.emphasis < 0 || data.emphasis > 1)) errors.push('speech emphasis must be within [0, 1]');
      if (data.f0MeanHz !== undefined && (!finite(data.f0MeanHz) || data.f0MeanHz <= 0)) errors.push('speech f0MeanHz must be positive');
      break;
    case 'speech-marker':
      if (!oneOf(data.marker, ['breath', 'filler', 'disfluency', 'pause'])) errors.push('speech-marker marker is invalid');
      if (data.text !== undefined && (typeof data.text !== 'string' || data.text.length > MAX_EVENT_TEXT_LENGTH)) errors.push('speech-marker text is invalid');
      if (data.speakerId !== undefined && !nonEmpty(data.speakerId)) errors.push('speech-marker speakerId must be non-empty');
      if (data.wordId !== undefined && !nonEmpty(data.wordId)) errors.push('speech-marker wordId must be non-empty');
      if (data.intensity !== undefined && (!finite(data.intensity) || data.intensity < 0 || data.intensity > 1)) errors.push('speech-marker intensity must be within [0, 1]');
      break;
    case 'person-visible':
      if (!nonEmpty(data.personId)) errors.push('person-visible data requires personId');
      if (data.faceTrackId !== undefined && !nonEmpty(data.faceTrackId)) errors.push('person-visible faceTrackId must be non-empty');
      if (data.position !== undefined && !oneOf(data.position, ['left', 'center', 'right', 'unknown'])) errors.push('person-visible position is invalid');
      break;
    case 'active-speaker':
      if (!nonEmpty(data.speakerId) || !oneOf(data.status, ['onscreen', 'offscreen', 'unknown', 'conflict']) || !oneOf(data.method, ['single-face', 'mouth-motion', 'model', 'manual', 'none'])) errors.push('active-speaker data is invalid');
      if (data.personId !== undefined && !nonEmpty(data.personId)) errors.push('active-speaker personId must be non-empty');
      if (data.candidatePersonIds !== undefined && !validStringList(data.candidatePersonIds, MAX_EVENT_LIST_ITEMS)) errors.push('active-speaker candidates are invalid');
      break;
    case 'camera-motion':
      if (!oneOf(data.motion, ['static', 'pan', 'tilt', 'zoom', 'dolly', 'handheld', 'global-motion', 'unknown'])) errors.push('camera-motion motion is invalid');
      if (data.direction !== undefined && !oneOf(data.direction, ['left', 'right', 'up', 'down', 'in', 'out', 'mixed'])) errors.push('camera-motion direction is invalid');
      if ((data.magnitude !== undefined && !finite(data.magnitude)) || (data.coherence !== undefined && !finite(data.coherence))) errors.push('camera-motion measurements must be finite');
      break;
    case 'audio-activity':
      if (!oneOf(data.activity, ['speech', 'music', 'noise', 'ambience', 'applause', 'silence', 'transient', 'unknown'])) errors.push('audio-activity data is invalid');
      if ((data.loudnessDb !== undefined && !finite(data.loudnessDb)) || (data.peakDb !== undefined && !finite(data.peakDb))) errors.push('audio-activity levels must be finite');
      break;
    case 'quality-issue':
      if (!oneOf(data.issue, ['focus', 'black', 'exposure', 'freeze', 'shake', 'clipping', 'quiet', 'silence', 'dropout', 'noise', 'flicker', 'compression']) || !oneOf(data.severity, ['info', 'warning', 'critical']) || !finite(data.measurement) || !finite(data.threshold) || !nonEmpty(data.unit)) errors.push('quality-issue data is invalid');
      break;
    case 'onscreen-text':
      if (typeof data.text !== 'string' || data.text.length > MAX_EVENT_TEXT_LENGTH || !oneOf(data.kind, ['subtitle', 'title', 'lower-third', 'sign', 'unknown'])) errors.push('onscreen-text data is invalid');
      if (data.originalText !== undefined && typeof data.originalText !== 'string') errors.push('onscreen-text originalText must be a string');
      if (data.language !== undefined && !nonEmpty(data.language)) errors.push('onscreen-text language must be non-empty');
      break;
    case 'duplicate-group':
      if (!nonEmpty(data.duplicateGroupId) || !validStringList(data.memberEventIds, MAX_EVENT_LIST_ITEMS) || !finite(data.similarity) || data.similarity < 0 || data.similarity > 1) errors.push('duplicate-group data is invalid');
      if (data.takeGroupId !== undefined && !nonEmpty(data.takeGroupId)) errors.push('duplicate-group takeGroupId must be non-empty');
      break;
    default:
      errors.push('unsupported event type');
  }
}

export function serializeAgentTimelineManifest(manifest: AgentTimelineManifest): string {
  const errors = validateAgentTimelineManifest(manifest);
  if (errors.length > 0) throw new TypeError(`Invalid Agent Timeline manifest: ${errors.join('; ')}`);
  return JSON.stringify(manifest);
}
