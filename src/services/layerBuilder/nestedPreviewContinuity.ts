import type { TimelineClip } from '../../types';
import type { PreviewContinuationOptions } from './videoSyncPreviewContinuations';

export interface NestedPreviewContinuationResolver {
  getPreviewContinuationVideoElement(
    clip: TimelineClip,
    targetTime: number,
    options?: PreviewContinuationOptions,
  ): HTMLVideoElement | null;
}

function hashNestedPreviewKey(parts: readonly string[]): string {
  const value = JSON.stringify(parts);
  let first = 0x811c9dc5;
  let second = 0x9e3779b1;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

export function getNestedPreviewRootTrackKey(clip: TimelineClip): string {
  return `nested-preview:${hashNestedPreviewKey([clip.trackId, clip.compositionId ?? clip.id])}`;
}

export function getNestedPreviewTrackKey(
  parentTrackKey: string,
  parentClip: TimelineClip,
  nestedClip: TimelineClip,
): string {
  return `nested-preview:${hashNestedPreviewKey([
    parentTrackKey,
    parentClip.compositionId ?? parentClip.id,
    nestedClip.trackId,
  ])}`;
}

export function getNestedClipContinuityKey(
  parentClip: TimelineClip,
  nestedClip: TimelineClip,
): string {
  const runtimePrefix = `nested-${parentClip.id}-`;
  const originalClipId = nestedClip.id.startsWith(runtimePrefix)
    ? nestedClip.id.slice(runtimePrefix.length)
    : nestedClip.id;
  return `nested-clip:${hashNestedPreviewKey([
    parentClip.compositionId ?? parentClip.id,
    originalClipId,
  ])}`;
}

export function getNestedPreviewSourceKey(trackKey: string, continuityKey: string): string {
  return `nested-video:${hashNestedPreviewKey([trackKey, continuityKey])}`;
}
