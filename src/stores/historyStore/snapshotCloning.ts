import { clonePersistedClipAudioState } from '../../services/audio/clipAudioStatePersistence';
import type {
  ClipAudioState,
  MasterAudioState,
  MediaFileAudioAnalysisRefs,
  TrackAudioState,
} from '../../types';
import type { Composition, MediaFile } from '../mediaStore/types';
import type { StateSnapshot } from './historyStoreTypes';

export function deepClone<T>(obj: T, seen?: WeakSet<object>): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (isBinaryPayload(obj)) return undefined as T;

  if (obj instanceof Element || obj instanceof HTMLMediaElement || obj instanceof File) {
    return obj;
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto && proto !== Object.prototype && proto !== Array.prototype) {
    return obj;
  }

  if (!seen) seen = new WeakSet();
  if (seen.has(obj as object)) return obj;
  seen.add(obj as object);

  if (Array.isArray(obj)) return obj.map(item => deepClone(item, seen)) as T;

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === 'function') continue;
      if (isBinaryPayload(value)) continue;
      if (value instanceof Element || value instanceof HTMLMediaElement) {
        cloned[key] = value;
      } else {
        cloned[key] = deepClone(value, seen);
      }
    }
  }
  return cloned;
}

export function isBinaryPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer) return true;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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
  if (isBinaryPayload(value)) return undefined;

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

const AUDIO_ANALYSIS_REF_KEYS: Array<keyof MediaFileAudioAnalysisRefs> = [
  'waveformPyramidId',
  'processedWaveformPyramidId',
  'spectrogramTileSetIds',
  'loudnessEnvelopeId',
  'beatGridId',
  'onsetMapId',
  'phaseCorrelationId',
  'transcriptTimingId',
  'frequencySummaryId',
];

function cloneAudioAnalysisRefs(
  refs: MediaFileAudioAnalysisRefs | undefined
): MediaFileAudioAnalysisRefs | undefined {
  if (!refs) return undefined;

  const cloned: Partial<Record<keyof MediaFileAudioAnalysisRefs, string | string[]>> = {};
  for (const key of AUDIO_ANALYSIS_REF_KEYS) {
    const value = refs[key];
    if (key === 'spectrogramTileSetIds') {
      if (Array.isArray(value)) {
        cloned[key] = value.filter((id): id is string => typeof id === 'string');
      }
    } else if (typeof value === 'string') {
      cloned[key] = value;
    }
  }

  return Object.keys(cloned).length > 0
    ? cloned as MediaFileAudioAnalysisRefs
    : undefined;
}

function cloneClipAudioState(audioState: ClipAudioState | undefined): ClipAudioState | undefined {
  const cloned = clonePersistedClipAudioState(cloneJsonSafeAudioValue(audioState) as ClipAudioState | undefined);
  if (!cloned) return undefined;

  const sourceAnalysisRefs = cloneAudioAnalysisRefs(audioState?.sourceAnalysisRefs);
  const processedAnalysisRefs = cloneAudioAnalysisRefs(audioState?.processedAnalysisRefs);
  if (sourceAnalysisRefs !== undefined) {
    cloned.sourceAnalysisRefs = sourceAnalysisRefs;
  } else {
    delete cloned.sourceAnalysisRefs;
  }
  if (processedAnalysisRefs !== undefined) {
    cloned.processedAnalysisRefs = processedAnalysisRefs;
  } else {
    delete cloned.processedAnalysisRefs;
  }

  return cloned;
}

function cloneTrackAudioState(audioState: TrackAudioState | undefined): TrackAudioState | undefined {
  return cloneJsonSafeAudioValue(audioState) as TrackAudioState | undefined;
}

export function cloneMasterAudioState(audioState: MasterAudioState | undefined): MasterAudioState | undefined {
  return cloneJsonSafeAudioValue(audioState) as MasterAudioState | undefined;
}

export function cloneClipForHistory<T extends { audioState?: ClipAudioState }>(clip: T): T {
  const {
    audioState,
    waveform: _waveform,
    waveformChannels: _waveformChannels,
    waveformGenerating: _waveformGenerating,
    waveformProgress: _waveformProgress,
    audioAnalysisJob: _audioAnalysisJob,
    ...rest
  } = clip as T & {
    waveform?: unknown;
    waveformChannels?: unknown;
    waveformGenerating?: unknown;
    waveformProgress?: unknown;
    audioAnalysisJob?: unknown;
  };
  const cloned = deepClone(rest) as T;
  const clonedAudioState = cloneClipAudioState(audioState);
  if (clonedAudioState !== undefined) {
    cloned.audioState = clonedAudioState;
  }
  return cloned;
}

export function cloneTrackForHistory<T extends { audioState?: TrackAudioState }>(track: T): T {
  const { audioState, ...rest } = track;
  const cloned = deepClone(rest) as T;
  const clonedAudioState = cloneTrackAudioState(audioState);
  if (clonedAudioState !== undefined) {
    cloned.audioState = clonedAudioState;
  }
  return cloned;
}

function cloneTimelineDataForHistory(
  timelineData: NonNullable<Composition['timelineData']>
): NonNullable<Composition['timelineData']> {
  const { clips, tracks, masterAudioState, ...rest } = timelineData;
  const cloned = deepClone(rest) as NonNullable<Composition['timelineData']>;
  cloned.clips = (clips || []).map(cloneClipForHistory);
  cloned.tracks = (tracks || []).map(cloneTrackForHistory);

  const clonedMasterAudioState = cloneMasterAudioState(masterAudioState);
  if (clonedMasterAudioState !== undefined) {
    cloned.masterAudioState = clonedMasterAudioState;
  }

  return cloned;
}

export function cloneCompositionForHistory(composition: Composition): Composition {
  const { timelineData, ...rest } = composition;
  const cloned = deepClone(rest) as Composition;
  if (timelineData) {
    cloned.timelineData = cloneTimelineDataForHistory(timelineData);
  }
  return cloned;
}

export function cloneMediaFileForHistory(file: MediaFile): MediaFile {
  const {
    audioAnalysisRefs,
    waveform: _waveform,
    waveformChannels: _waveformChannels,
    waveformProgress: _waveformProgress,
    waveformStatus: _waveformStatus,
    ...rest
  } = file;
  const cloned = deepClone(rest) as MediaFile;
  const clonedAudioAnalysisRefs = cloneAudioAnalysisRefs(audioAnalysisRefs);
  if (clonedAudioAnalysisRefs !== undefined) {
    cloned.audioAnalysisRefs = clonedAudioAnalysisRefs;
  }
  return cloned;
}

export function cloneSnapshotStack(snapshots: StateSnapshot[]): StateSnapshot[] {
  return snapshots.map((snapshot) => deepClone(snapshot));
}

function sanitizeHistoryValueForProject(key: string, value: unknown): unknown {
  if (key === 'file') return undefined;
  if (
    (key === 'url' || key === 'thumbnailUrl' || key === 'proxyVideoUrl') &&
    typeof value === 'string' &&
    value.startsWith('blob:')
  ) {
    return undefined;
  }
  if (typeof File !== 'undefined' && value instanceof File) return undefined;
  if (typeof Element !== 'undefined' && value instanceof Element) return undefined;
  if (typeof HTMLMediaElement !== 'undefined' && value instanceof HTMLMediaElement) return undefined;
  if (isBinaryPayload(value)) return undefined;
  return value;
}

export function cloneHistoryForProject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, sanitizeHistoryValueForProject)) as T;
}
