import { isRetainedTerrainMesh } from '../../services/planarTracking/immutableTerrainMesh';
import { clonePlanarTracks } from '../../services/planarTracking/clonePlanarTracks';
import { cloneTerrainAnchorConnector, cloneTerrainAttachment, cloneTerrainScreenAnchor } from '../../types/terrainAttachment';
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
  TempoMap,
  TimelineClip,
  TimelineTrack,
  TrackAudioState,
} from '../../types';
import type { TimelineMarker } from './types';
import { normalizeMotionLayerDefinition } from '../../services/motionDesign/contracts/replicatorTimelineAdapter';

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
  liveInputId?: string;
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
  liveInputId?: string;
  signalAssetId?: string;
  signalRefId?: string;
  signalRenderAdapterId?: string;
  linkedClipId?: string;
  linkedGroupId?: string;
  editableHook?: TimelineClip['editableHook'];
  parentClipId?: string;
  naturalDuration?: number;
  videoState?: ClipVideoState;
  videoInspectorSections?: TimelineClip['videoInspectorSections'];
  audioState?: ClipAudioState;
  transform: ClipTransform;
  effects: Effect[];
  planarTracks?: TimelineClip['planarTracks'];
  trackingBinding?: TimelineClip['trackingBinding'];
  terrainAttachment?: TimelineClip['terrainAttachment'];
  terrainScreenAnchor?: TimelineClip['terrainScreenAnchor'];
  terrainAnchorConnector?: TimelineClip['terrainAnchorConnector'];
  colorCorrection?: ColorCorrectionState;
  nodeGraph?: ClipNodeGraph;
  keyframes?: Keyframe[];
  masks?: ClipMask[];
  transcriptStatus?: TimelineClip['transcriptStatus'];
  analysisStatus?: TimelineClip['analysisStatus'];
  faceAnalysisStatus?: TimelineClip['faceAnalysisStatus'];
  faceAnalysisMessage?: string;
  sceneDescriptionStatus?: TimelineClip['sceneDescriptionStatus'];
  reversed?: boolean;
  speed?: number;
  preservesPitch?: boolean;
  followsLinkedVideoSpeed?: boolean;
  freeRun?: boolean;
  textProperties?: TimelineClip['textProperties'];
  captionProperties?: TimelineClip['captionProperties'];
  captionLayerBinding?: TimelineClip['captionLayerBinding'];
  text3DProperties?: TimelineClip['text3DProperties'];
  cameraSettings?: SerializableClip['cameraSettings'];
  threeDEffectorsEnabled?: boolean;
  solidColor?: string;
  transitionOverlay?: TimelineClip['transitionOverlay'];
  midiData?: TimelineClip['midiData'];
  automation?: TimelineClip['automation'];
  vectorAnimationSettings?: SerializableClip['vectorAnimationSettings'];
  mathScene?: TimelineClip['mathScene'];
  motion?: TimelineClip['motion'];
  flock?: TimelineClip['flock'];
  isComposition?: boolean;
  compositionId?: string;
  transitionIn?: TimelineClip['transitionIn'];
  transitionOut?: TimelineClip['transitionOut'];
  is3D?: boolean;
  wireframe?: boolean;
  meshType?: TimelineClip['meshType'];
  storyboardProperties?: TimelineClip['storyboardProperties'];
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
    // Optional so schema-v1 entries written before Motion Design duration
    // parity remain readable without changing the persisted schema version.
    duration?: number;
    durationLocked?: boolean;
    tracks: HistoryTimelineTrackEditState[];
    clips: HistoryTimelineClipEditState[];
    selectedClipIds: string[];
    zoom: number;
    scrollX: number;
    layers: HistoryTimelineLayerEditState[];
    selectedLayerId: string | null;
    clipKeyframes: Record<string, Keyframe[]>;
    markers: TimelineMarker[];
    // Optional so schema v1 entries written before #299 stay readable.
    tempoMap?: TempoMap;
    masterAudioState?: MasterAudioState;
  };
}

export interface CreateHistoryTimelineEditStateInput {
  id: string;
  label: string;
  timestamp: number;
  duration?: number;
  durationLocked?: boolean;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  selectedClipIds: Iterable<string>;
  zoom: number;
  scrollX: number;
  layers?: Layer[];
  selectedLayerId?: string | null;
  clipKeyframes?: Map<string, Keyframe[]> | Record<string, Keyframe[]>;
  markers?: TimelineMarker[];
  tempoMap?: TempoMap;
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

const validatedTerrainMeshes = new WeakSet<object>();

function stripUndefinedDeep(value: unknown): unknown {
  if (value && typeof value === 'object' && isRetainedTerrainMesh(value)) return value;
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

/** These objects are dictionaries whose property names are user/domain IDs.
 * A node can legitimately be named `source`, `texture`, or another runtime-like token. */
function isDurableIdMapPath(path: string): boolean {
  return path.endsWith('.nodeGraph.previews.nodes')
    || path.endsWith('.nodeGraph.scene.graph.layout')
    || path.endsWith('.operatorGraph.layout')
    || (path.includes('.nodeGraph.canvasPlacements.') && path.endsWith('.nodes'))
    || (path.includes('.nodeGraph.groups.') && path.endsWith('.nodeLayouts'));
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
    if (validatedTerrainMeshes.has(candidate as object)) return;
    const violationCount = violations.length;

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
      // Durable keyed maps use arbitrary node IDs. Their values are still fully
      // traversed, so a real videoElement/File/etc. nested inside remains rejected.
      if (HISTORY_RUNTIME_PAYLOAD_KEYS.has(key) && child !== null && typeof child === 'object' && !isDurableIdMapPath(path)) {
        violations.push(`${childPath}: runtime payload key`);
        continue;
      }
      visit(child, childPath);
    }
    stack.delete(candidate);
    if (isRetainedTerrainMesh(candidate) && violations.length === violationCount) {
      validatedTerrainMeshes.add(candidate);
    }
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
  return withoutUndefined as T;
}

export function createHistoryTimelineRuntimeRef(clip: TimelineClip): HistoryTimelineRuntimeRef {
  const sourceType = clip.source?.type ?? 'video';
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const liveInputId = clip.source?.liveInputId;

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

  if (
    sourceType === 'camera' ||
    (sourceType === 'model' && Boolean(clip.meshType ?? clip.source?.meshType)) ||
    (sourceType === 'flock' && Boolean(clip.flock))
  ) {
    return {
      kind: 'generated',
      sourceType,
      mediaFileId,
      naturalDuration: clip.source?.naturalDuration,
      needsReload: false,
    };
  }

  if (liveInputId) {
    return {
      kind: 'media-file',
      sourceType,
      mediaFileId: mediaFileId ?? liveInputId,
      liveInputId,
      naturalDuration: clip.source?.naturalDuration,
    };
  }

  if (mediaFileId) {
    return {
      kind: 'media-file',
      sourceType,
      mediaFileId,
      liveInputId,
      naturalDuration: clip.source?.naturalDuration,
      needsReload: clip.needsReload,
    };
  }

  if (
    sourceType === 'text' ||
    sourceType === 'solid' ||
    sourceType === 'midi' ||
    sourceType === 'storyboard'
  ) {
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
    liveInputId: clip.source?.liveInputId,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    editableHook: clip.editableHook ? { ...clip.editableHook } : undefined,
    parentClipId: clip.parentClipId,
    naturalDuration: clip.source?.naturalDuration,
    videoState: cloneOptionalPlainData(clip.videoState),
    videoInspectorSections: cloneOptionalPlainData(clip.videoInspectorSections),
    audioState: cloneAudioPlainData<ClipAudioState>(clip.audioState),
    transform: clip.transform,
    effects: clip.effects,
        planarTracks: clonePlanarTracks(clip.planarTracks),
        trackingBinding: clip.trackingBinding ? structuredClone(clip.trackingBinding) : undefined,
        terrainAttachment: cloneTerrainAttachment(clip.terrainAttachment),
        terrainScreenAnchor: cloneTerrainScreenAnchor(clip.terrainScreenAnchor),
        terrainAnchorConnector: cloneTerrainAnchorConnector(clip.terrainAnchorConnector),
    colorCorrection: clip.colorCorrection,
    nodeGraph: clip.nodeGraph,
    keyframes: keyframes.length > 0 ? keyframes : undefined,
    masks: clip.masks && clip.masks.length > 0 ? clip.masks : undefined,
    transcriptStatus: clip.transcriptStatus,
    analysisStatus: clip.analysisStatus,
    faceAnalysisStatus: clip.faceAnalysisStatus,
    faceAnalysisMessage: clip.faceAnalysisMessage,
    sceneDescriptionStatus: clip.sceneDescriptionStatus,
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    followsLinkedVideoSpeed: clip.followsLinkedVideoSpeed,
    freeRun: clip.freeRun,
    textProperties: clip.textProperties,
    captionProperties: clip.captionProperties,
    captionLayerBinding: clip.captionLayerBinding,
    text3DProperties: clip.text3DProperties ?? clip.source?.text3DProperties,
    cameraSettings: clip.source?.cameraSettings,
    threeDEffectorsEnabled: clip.source?.threeDEffectorsEnabled,
    solidColor: clip.solidColor,
    transitionOverlay: clip.transitionOverlay ?? clip.source?.transitionOverlay,
    midiData: clip.midiData,
    automation: clip.automation,
    vectorAnimationSettings: clip.source?.vectorAnimationSettings,
    mathScene: clip.mathScene,
    motion: clip.motion ? normalizeMotionLayerDefinition(clip.motion) : undefined,
    flock: clip.flock,
    isComposition: clip.isComposition,
    compositionId: clip.compositionId,
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
    is3D: clip.is3D,
    wireframe: clip.wireframe,
    meshType: clip.meshType ?? clip.source?.meshType,
    storyboardProperties: clip.storyboardProperties,
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
      duration: input.duration,
      durationLocked: input.durationLocked,
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
      tempoMap: input.tempoMap ? cloneHistoryPlainData(input.tempoMap) : undefined,
      masterAudioState: cloneAudioPlainData<MasterAudioState>(input.masterAudioState),
    },
  };

  return cloneHistoryPlainData(state);
}
