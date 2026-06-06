export type TimelineRenderModelVersion = 1;

export type TimelineSourceKind =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'solid'
  | 'camera'
  | 'composition'
  | 'model'
  | 'gaussian-splat'
  | 'vector-animation'
  | 'midi'
  | 'data'
  | 'unknown';

export type TimelineRenderTrackKind =
  | 'video'
  | 'audio'
  | 'mixed'
  | 'data'
  | 'control';

export type TimelineRenderStatus =
  | 'none'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'error'
  | 'missing';

export interface TimelineProgressState {
  status: TimelineRenderStatus;
  progress?: number;
  errorCode?: string;
}

export interface TimelineRenderPalette {
  fill: string;
  stroke?: string;
  text?: string;
  accent?: string;
  mutedFill?: string;
}

export interface TimelineRenderTrack {
  id: string;
  index: number;
  name: string;
  kind: TimelineRenderTrackKind;
  color: string;
  locked: boolean;
  muted: boolean;
  hidden: boolean;
  expanded: boolean;
  dimmed: boolean;
  baseHeightPx: number;
  heightPx: number;
}

export interface TimelinePassiveBadgeState {
  proxy?: TimelineProgressState;
  audioProxy?: TimelineProgressState;
  download?: TimelineProgressState;
  stem?: TimelineProgressState & {
    activeStemId?: string;
    stemCount?: number;
  };
  reloadRequired?: boolean;
  reversed?: boolean;
  linked?: {
    linkedClipId?: string;
    linkedGroupId?: string;
  };
  transcript?: TimelineProgressState & {
    markerCount?: number;
  };
  analysis?: TimelineProgressState & {
    markerCount?: number;
  };
  nestedComposition?: {
    compositionId: string;
    hasMixdown: boolean;
    boundaryCount?: number;
  };
}

export interface TimelineThumbnailCacheRef {
  sourceId: string;
  mediaFileId?: string;
  fileHash?: string;
  frameCount?: number;
  durationSeconds?: number;
}

export interface TimelineWaveformCacheRef {
  sourceRefId: string;
  processedRefId?: string;
  channelCount?: number;
  referencePeak?: number;
}

export interface TimelineSpectrogramCacheRef {
  sourceRefId: string;
  processedRefId?: string;
  tileSetId?: string;
  tileCount?: number;
}

export interface TimelineAudioAnalysisCacheRef {
  refId: string;
  sourceRefId?: string;
  processedRefId?: string;
}

export interface TimelineClipCacheRefs {
  thumbnails?: TimelineThumbnailCacheRef;
  waveform?: TimelineWaveformCacheRef;
  spectrogram?: TimelineSpectrogramCacheRef;
  loudness?: TimelineAudioAnalysisCacheRef;
  beatOnset?: TimelineAudioAnalysisCacheRef;
  frequencyPhase?: TimelineAudioAnalysisCacheRef;
  analysisMarkers?: TimelineAudioAnalysisCacheRef;
}

export interface TimelineMarkerSummary {
  id: string;
  time: number;
  duration?: number;
  kind: 'transcript' | 'analysis' | 'beat' | 'onset' | 'custom';
  label?: string;
  confidence?: number;
}

export interface TimelineFadeSummary {
  fadeInDuration: number;
  fadeOutDuration: number;
  opacityKeyframeCount?: number;
}

export interface TimelineRenderClipState {
  selected: boolean;
  hovered: boolean;
  locked: boolean;
  muted: boolean;
  linked: boolean;
  inLinkedGroup: boolean;
  dimmed: boolean;
  disabled: boolean;
}

export interface TimelineRenderClip {
  id: string;
  trackId: string;
  index: number;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  reversed: boolean;
  sourceKind: TimelineSourceKind;
  sourceId?: string;
  mediaFileId?: string;
  label: string;
  palette: TimelineRenderPalette;
  state: TimelineRenderClipState;
  badges: TimelinePassiveBadgeState;
  cacheRefs: TimelineClipCacheRefs;
  markers: TimelineMarkerSummary[];
  fade?: TimelineFadeSummary;
  keyframeCount?: number;
}

export interface TimelineRenderModel {
  schemaVersion: TimelineRenderModelVersion;
  tracks: TimelineRenderTrack[];
  clips: TimelineRenderClip[];
  selectedClipIds: string[];
  hoveredClipId?: string | null;
  primarySelectedClipId?: string | null;
  generatedAtMs?: number;
}

export interface TimelineRuntimeReferenceIssue {
  path: string;
  code:
    | 'function'
    | 'symbol'
    | 'object-url'
    | 'non-plain-object'
    | 'cycle';
  valueTag: string;
}

const OBJECT_URL_PATTERN = /^blob:/i;

function getValueTag(value: unknown): string {
  return Object.prototype.toString.call(value);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function childPath(parentPath: string, key: string | number): string {
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parentPath}.${key}` : `${parentPath}[${JSON.stringify(key)}]`;
}

export function findTimelineRuntimeReferences(
  value: unknown,
  path = '$',
  stack: WeakSet<object> = new WeakSet(),
): TimelineRuntimeReferenceIssue[] {
  if (typeof value === 'function') {
    return [{ path, code: 'function', valueTag: getValueTag(value) }];
  }

  if (typeof value === 'symbol') {
    return [{ path, code: 'symbol', valueTag: getValueTag(value) }];
  }

  if (typeof value === 'string') {
    return OBJECT_URL_PATTERN.test(value)
      ? [{ path, code: 'object-url', valueTag: 'string' }]
      : [];
  }

  if (value === null || typeof value !== 'object') {
    return [];
  }

  if (stack.has(value)) {
    return [{ path, code: 'cycle', valueTag: getValueTag(value) }];
  }
  stack.add(value);

  if (Array.isArray(value)) {
    const issues = value.flatMap((entry, index) => findTimelineRuntimeReferences(entry, childPath(path, index), stack));
    stack.delete(value);
    return issues;
  }

  if (!isPlainObject(value)) {
    stack.delete(value);
    return [{ path, code: 'non-plain-object', valueTag: getValueTag(value) }];
  }

  const issues = Object.entries(value).flatMap(([key, entry]) => (
    findTimelineRuntimeReferences(entry, childPath(path, key), stack)
  ));
  stack.delete(value);
  return issues;
}

export function isPlainTimelineRenderData(value: unknown): boolean {
  return findTimelineRuntimeReferences(value).length === 0;
}
