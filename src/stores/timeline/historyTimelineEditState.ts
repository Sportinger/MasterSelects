import type {
  ClipAudioState,
  ClipMask,
  ClipNodeGraph,
  ClipTransform,
  ClipVideoState,
  ColorCorrectionState,
  Effect,
  Keyframe,
  Layer,
  MasterAudioState,
  SerializableClip,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../types';
import type { TimelineMarker } from './types';

export const HISTORY_TIMELINE_EDIT_STATE_SCHEMA_VERSION = 1 as const;
export const HISTORY_TIMELINE_EDIT_STATE_KIND = 'history-timeline-edit-state' as const;

export type HistoryTimelineEditStateSchemaVersion =
  typeof HISTORY_TIMELINE_EDIT_STATE_SCHEMA_VERSION;

export type HistoryJsonPrimitive = string | number | boolean | null;
export type HistoryJsonValue =
  | HistoryJsonPrimitive
  | HistoryJsonValue[]
  | { [key: string]: HistoryJsonValue };

export type HistoryTimelineRuntimeRefKind =
  | 'media-file'
  | 'composition'
  | 'signal'
  | 'generated'
  | 'inline-data'
  | 'missing-media';

export interface HistoryTimelineRuntimeRef {
  kind: HistoryTimelineRuntimeRefKind;
  sourceType: SerializableClip['sourceType'];
  mediaFileId?: string;
  compositionId?: string;
  signalAssetId?: string;
  signalRefId?: string;
  signalRenderAdapterId?: string;
  naturalDuration?: number;
  needsReload?: boolean;
}

export interface HistoryTimelineTrackEditState {
  id: string;
  name: string;
  type: TimelineTrack['type'];
  height: number;
  labelColor?: TimelineTrack['labelColor'];
  muted: boolean;
  visible: boolean;
  solo: boolean;
  locked?: boolean;
  parentTrackId?: string;
  audioState?: TimelineTrack['audioState'];
  midiInstrument?: TimelineTrack['midiInstrument'];
}

export interface HistoryTimelineClipEditState {
  id: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceType: SerializableClip['sourceType'];
  runtimeRef: HistoryTimelineRuntimeRef;
  mediaFileId?: string;
  signalAssetId?: string;
  signalRefId?: string;
  signalRenderAdapterId?: string;
  linkedClipId?: string;
  linkedGroupId?: string;
  parentClipId?: string;
  naturalDuration?: number;
  videoState?: ClipVideoState;
  audioState?: ClipAudioState;
  transform: ClipTransform;
  effects: Effect[];
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: ClipNodeGraph;
  keyframes?: Keyframe[];
  masks?: ClipMask[];
  transcriptStatus?: TimelineClip['transcriptStatus'];
  analysisStatus?: TimelineClip['analysisStatus'];
  sceneDescriptionStatus?: TimelineClip['sceneDescriptionStatus'];
  reversed?: boolean;
  speed?: number;
  preservesPitch?: boolean;
  textProperties?: TimelineClip['textProperties'];
  text3DProperties?: TimelineClip['text3DProperties'];
  solidColor?: string;
  transitionOverlay?: TimelineClip['transitionOverlay'];
  midiData?: TimelineClip['midiData'];
  automation?: TimelineClip['automation'];
  vectorAnimationSettings?: SerializableClip['vectorAnimationSettings'];
  mathScene?: TimelineClip['mathScene'];
  motion?: TimelineClip['motion'];
  isComposition?: boolean;
  compositionId?: string;
  transitionIn?: TimelineClip['transitionIn'];
  transitionOut?: TimelineClip['transitionOut'];
  is3D?: boolean;
  wireframe?: boolean;
  meshType?: TimelineClip['meshType'];
}

export interface HistoryTimelineLayerSourceRef {
  type: NonNullable<Layer['source']>['type'];
  sourceClipId?: string;
  mediaFileId?: string;
  previewPath?: string;
  proxyFrameIndex?: number;
}

export interface HistoryTimelineLayerEditState
  extends Omit<Layer, 'source'> {
  sourceRef: HistoryTimelineLayerSourceRef | null;
}

export interface HistoryTimelineEditState {
  kind: typeof HISTORY_TIMELINE_EDIT_STATE_KIND;
  schemaVersion: HistoryTimelineEditStateSchemaVersion;
  id: string;
  label: string;
  timestamp: number;
  timeline: {
    tracks: HistoryTimelineTrackEditState[];
    clips: HistoryTimelineClipEditState[];
    selectedClipIds: string[];
    zoom: number;
    scrollX: number;
    layers: HistoryTimelineLayerEditState[];
    selectedLayerId: string | null;
    clipKeyframes: Record<string, Keyframe[]>;
    markers: TimelineMarker[];
    masterAudioState?: MasterAudioState;
  };
}

export interface CreateHistoryTimelineEditStateInput {
  id: string;
  label: string;
  timestamp: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  selectedClipIds: Iterable<string>;
  zoom: number;
  scrollX: number;
  layers?: Layer[];
  selectedLayerId?: string | null;
  clipKeyframes?: Map<string, Keyframe[]> | Record<string, Keyframe[]>;
  markers?: TimelineMarker[];
  masterAudioState?: MasterAudioState;
}

const HISTORY_RUNTIME_PAYLOAD_KEYS = new Set([
  'source',
  'file',
  'videoElement',
  'audioElement',
  'imageElement',
  'webCodecsPlayer',
  'nativeDecoder',
  'textCanvas',
  'videoFrame',
  'texture',
  'mixdownAudio',
  'mixdownBuffer',
  'nestedClips',
  'nestedTracks',
  'audioAnalysisJob',
]);

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) {
      output[key] = stripUndefinedDeep(child);
    }
  }
  return output;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function findHistoryStateBoundaryViolations(value: unknown): string[] {
  const violations: string[] = [];
  const stack = new WeakSet<object>();

  const visit = (candidate: unknown, path: string): void => {
    if (candidate === null) return;

    const valueType = typeof candidate;
    if (valueType === 'string' || valueType === 'boolean') return;
    if (valueType === 'number') {
      if (!Number.isFinite(candidate)) {
        violations.push(`${path}: non-finite number`);
      }
      return;
    }

    if (valueType === 'undefined') {
      violations.push(`${path}: undefined value`);
      return;
    }

    if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
      violations.push(`${path}: ${valueType} value`);
      return;
    }

    if (!candidate || valueType !== 'object') return;

    if (stack.has(candidate)) {
      violations.push(`${path}: circular reference`);
      return;
    }
    stack.add(candidate);

    if (Array.isArray(candidate)) {
      candidate.forEach((child, index) => visit(child, `${path}[${index}]`));
      stack.delete(candidate);
      return;
    }

    if (!isPlainObject(candidate)) {
      const ctor = candidate.constructor?.name ?? 'non-plain object';
      violations.push(`${path}: ${ctor}`);
      stack.delete(candidate);
      return;
    }

    for (const [key, child] of Object.entries(candidate)) {
      const childPath = `${path}.${key}`;
      // Runtime-payload key names (source, videoElement, file, …) hold handles
      // that must never enter history — but only guard them when the value is an
      // actual object handle. A plain primitive under the same name is
      // serializable and must pass: e.g. the mod-matrix route's string
      // `source: 'velocity'` shares the name of a media clip's runtime `source`
      // handle but is durable JSON (#298).
      if (HISTORY_RUNTIME_PAYLOAD_KEYS.has(key) && child !== null && typeof child === 'object') {
        violations.push(`${childPath}: runtime payload key`);
        continue;
      }
      visit(child, childPath);
    }
    stack.delete(candidate);
  };

  visit(value, '$');
  return violations;
}

export function assertHistoryTimelineEditStateSerializable(value: unknown): asserts value is HistoryTimelineEditState {
  const violations = findHistoryStateBoundaryViolations(value);
  if (violations.length > 0) {
    throw new Error(`HistoryTimelineEditState is not serializable plain data: ${violations.join('; ')}`);
  }
}

export function cloneHistoryPlainData<T>(value: T): T {
  const withoutUndefined = stripUndefinedDeep(value);
  assertHistoryTimelineEditStateSerializable(withoutUndefined);
  return JSON.parse(JSON.stringify(withoutUndefined)) as T;
}

export function createHistoryTimelineRuntimeRef(clip: TimelineClip): HistoryTimelineRuntimeRef {
  const sourceType = clip.source?.type ?? 'video';
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;

  if (clip.isComposition && clip.compositionId) {
    return {
      kind: 'composition',
      sourceType,
      compositionId: clip.compositionId,
      naturalDuration: clip.source?.naturalDuration,
      needsReload: clip.needsReload,
    };
  }

  if (clip.signalAssetId || clip.signalRefId || clip.signalRenderAdapterId) {
    return {
      kind: 'signal',
      sourceType,
      signalAssetId: clip.signalAssetId,
      signalRefId: clip.signalRefId,
      signalRenderAdapterId: clip.signalRenderAdapterId,
      naturalDuration: clip.source?.naturalDuration,
      needsReload: clip.needsReload,
    };
  }

  if (mediaFileId) {
    return {
      kind: 'media-file',
      sourceType,
      mediaFileId,
      naturalDuration: clip.source?.naturalDuration,
      needsReload: clip.needsReload,
    };
  }

  if (sourceType === 'text' || sourceType === 'solid' || sourceType === 'midi') {
    return {
      kind: 'inline-data',
      sourceType,
      naturalDuration: clip.source?.naturalDuration,
      needsReload: clip.needsReload,
    };
  }

  return {
    kind: 'missing-media',
    sourceType,
    naturalDuration: clip.source?.naturalDuration,
    needsReload: clip.needsReload,
  };
}

function cloneOptionalPlainData<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : cloneHistoryPlainData(value);
}

function isAudioBinaryPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) return true;
  return false;
}

function isAudioPayloadKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, '').toLowerCase();

  if (
    normalized === 'payloadrefs' ||
    normalized.endsWith('ref') ||
    normalized.endsWith('refs') ||
    normalized.endsWith('id') ||
    normalized.endsWith('ids')
  ) {
    return false;
  }

  return (
    normalized === 'payload' ||
    normalized === 'bytes' ||
    normalized === 'buffer' ||
    normalized === 'blob' ||
    normalized === 'file' ||
    normalized === 'waveform' ||
    normalized === 'samples' ||
    normalized === 'sampledata' ||
    normalized === 'audiobuffer' ||
    normalized === 'arraybuffer' ||
    normalized.endsWith('samples') ||
    normalized.endsWith('bytes') ||
    normalized.endsWith('buffer') ||
    normalized.includes('channeldata') ||
    normalized.includes('rawaudio') ||
    normalized.includes('audiodata') ||
    normalized.includes('pcm') ||
    normalized.includes('fftdata') ||
    normalized.includes('waveformdata') ||
    normalized.includes('spectrogramdata') ||
    normalized.includes('tilebytes')
  );
}

function cloneJsonSafeAudioValue<T>(value: T, seen?: WeakSet<object>): T | undefined {
  if (value === null) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object') return undefined;
  if (isAudioBinaryPayload(value)) return undefined;

  if (!seen) seen = new WeakSet<object>();
  if (seen.has(value as object)) return undefined;
  seen.add(value as object);

  if (Array.isArray(value)) {
    const clonedArray: unknown[] = [];
    for (const item of value) {
      const clonedItem = cloneJsonSafeAudioValue(item, seen);
      if (clonedItem !== undefined) {
        clonedArray.push(clonedItem);
      }
    }
    return clonedArray as T;
  }

  if (!isPlainObject(value)) return undefined;

  const cloned: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isAudioPayloadKey(key)) continue;
    const clonedValue = cloneJsonSafeAudioValue(nestedValue, seen);
    if (clonedValue !== undefined) {
      cloned[key] = clonedValue;
    }
  }

  return cloned as T;
}

function cloneAudioPlainData<T>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  const cloned = cloneJsonSafeAudioValue(value);
  return cloned === undefined ? undefined : cloneHistoryPlainData(cloned);
}

function readKeyframes(
  keyframes: CreateHistoryTimelineEditStateInput['clipKeyframes'],
  clipId: string,
): Keyframe[] {
  if (!keyframes) return [];
  if (keyframes instanceof Map) {
    return keyframes.get(clipId) ?? [];
  }
  return keyframes[clipId] ?? [];
}

export function toHistoryTimelineTrackEditState(track: TimelineTrack): HistoryTimelineTrackEditState {
  return cloneHistoryPlainData({
    id: track.id,
    name: track.name,
    type: track.type,
    height: track.height,
    labelColor: track.labelColor,
    muted: track.muted,
    visible: track.visible,
    solo: track.solo,
    locked: track.locked,
    parentTrackId: track.parentTrackId,
    audioState: cloneAudioPlainData<TrackAudioState>(track.audioState),
    midiInstrument: track.midiInstrument,
  });
}

export function toHistoryTimelineClipEditState(
  clip: TimelineClip,
  keyframes: Keyframe[] = [],
): HistoryTimelineClipEditState {
  const sourceType = clip.source?.type ?? 'video';
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;

  return cloneHistoryPlainData({
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType,
    runtimeRef: createHistoryTimelineRuntimeRef(clip),
    mediaFileId,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    parentClipId: clip.parentClipId,
    naturalDuration: clip.source?.naturalDuration,
    videoState: cloneOptionalPlainData(clip.videoState),
    audioState: cloneAudioPlainData<ClipAudioState>(clip.audioState),
    transform: clip.transform,
    effects: clip.effects,
    colorCorrection: clip.colorCorrection,
    nodeGraph: clip.nodeGraph,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
    masks: clip.masks && clip.masks.length > 0 ? clip.masks : undefined,
    transcriptStatus: clip.transcriptStatus,
    analysisStatus: clip.analysisStatus,
    sceneDescriptionStatus: clip.sceneDescriptionStatus,
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    textProperties: clip.textProperties,
    text3DProperties: clip.text3DProperties ?? clip.source?.text3DProperties,
    solidColor: clip.solidColor,
    transitionOverlay: clip.transitionOverlay ?? clip.source?.transitionOverlay,
    midiData: clip.midiData,
    automation: clip.automation,
    vectorAnimationSettings: clip.source?.vectorAnimationSettings,
    mathScene: clip.mathScene,
    motion: clip.motion,
    isComposition: clip.isComposition,
    compositionId: clip.compositionId,
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
    is3D: clip.is3D,
    wireframe: clip.wireframe,
    meshType: clip.meshType ?? clip.source?.meshType,
  });
}

export function toHistoryTimelineLayerEditState(layer: Layer): HistoryTimelineLayerEditState {
  const { source, ...layerWithoutSource } = layer;
  return cloneHistoryPlainData({
    ...layerWithoutSource,
    sourceRef: source
      ? {
          type: source.type,
          sourceClipId: layer.sourceClipId,
          mediaFileId: source.mediaFileId,
          previewPath: source.previewPath,
          proxyFrameIndex: source.proxyFrameIndex,
        }
      : null,
  });
}

export function createHistoryTimelineEditState(
  input: CreateHistoryTimelineEditStateInput,
): HistoryTimelineEditState {
  const state: HistoryTimelineEditState = {
    kind: HISTORY_TIMELINE_EDIT_STATE_KIND,
    schemaVersion: HISTORY_TIMELINE_EDIT_STATE_SCHEMA_VERSION,
    id: input.id,
    label: input.label,
    timestamp: input.timestamp,
    timeline: {
      tracks: input.tracks.map(toHistoryTimelineTrackEditState),
      clips: input.clips.map((clip) =>
        toHistoryTimelineClipEditState(clip, readKeyframes(input.clipKeyframes, clip.id))
      ),
      selectedClipIds: Array.from(input.selectedClipIds),
      zoom: input.zoom,
      scrollX: input.scrollX,
      layers: (input.layers ?? []).map(toHistoryTimelineLayerEditState),
      selectedLayerId: input.selectedLayerId ?? null,
      clipKeyframes: cloneHistoryPlainData(input.clipKeyframes instanceof Map
        ? Object.fromEntries(input.clipKeyframes)
        : input.clipKeyframes ?? {}),
      markers: cloneHistoryPlainData(input.markers ?? []),
      masterAudioState: cloneAudioPlainData<MasterAudioState>(input.masterAudioState),
    },
  };

  return cloneHistoryPlainData(state);
}
