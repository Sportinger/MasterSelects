import type { TimelineClip, TimelineClipDataSource } from '../../types/timeline';

const RUNTIME_SOURCE_KEYS = [
  'videoElement',
  'audioElement',
  'imageElement',
  'textCanvas',
  'webCodecsPlayer',
  'nativeDecoder',
  'runtimeSourceId',
  'runtimeSessionKey',
  'file',
] as const;

type TimelineClipSource = TimelineClip['source'];
type TimelineClipDataSourceOrNull = TimelineClipDataSource | null;

export function stripTimelineSourceRuntimeHandles(source: TimelineClipSource): TimelineClipDataSourceOrNull {
  if (!source) return source;

  const dataOnlySource = { ...source } as Record<string, unknown>;
  for (const key of RUNTIME_SOURCE_KEYS) {
    delete dataOnlySource[key];
  }

  return dataOnlySource as unknown as TimelineClipDataSource;
}

export function getDataOnlyTimelineSource(clip: Pick<TimelineClip, 'source'>): TimelineClipDataSourceOrNull {
  return stripTimelineSourceRuntimeHandles(clip.source);
}

export function hasTimelineSourceRuntimeHandles(source: TimelineClipSource): boolean {
  if (!source) return false;
  return RUNTIME_SOURCE_KEYS.some((key) => key in source);
}
