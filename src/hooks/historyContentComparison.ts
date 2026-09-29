import type { MediaFile } from '../stores/mediaStore/types';
import type { TimelineClip } from '../types/timeline';
import {
  createMediaFilesHistorySignature,
  createTimelineClipsHistorySignature,
  createTimelineMasksHistorySignature,
} from './historyContentSignatures';

/** Store updates preserve unchanged items. Normalize only the changed pair,
 * rather than serializing every clip twice for each waveform progress update.
 * No cached signatures: explicit signature reads still observe nested edits.
 */
function itemsMatch<T>(
  current: readonly T[],
  previous: readonly T[],
  signature: (items: T[]) => string,
): boolean {
  if (current === previous) return true;
  if (current.length !== previous.length) return false;
  return current.every((item, index) => item === previous[index]
    || signature([item]) === signature([previous[index]]));
}

export function timelineClipsHistoryMatch(current: TimelineClip[], previous: TimelineClip[]): boolean {
  return itemsMatch(current, previous, createTimelineClipsHistorySignature);
}

export function timelineMasksHistoryMatch(current: TimelineClip[], previous: TimelineClip[]): boolean {
  return itemsMatch(current, previous, createTimelineMasksHistorySignature);
}

export function mediaFilesHistoryMatch(current: MediaFile[], previous: MediaFile[]): boolean {
  return itemsMatch(current, previous, createMediaFilesHistorySignature);
}
