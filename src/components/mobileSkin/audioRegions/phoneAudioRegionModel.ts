// Pure rules of the phone's sound range editor: which clip it edits, how a touch on the waveform
// becomes the editor's TimelineAudioRegionSelection (the same resolver the desktop waveform uses),
// and which channel mask a command takes. No React, no store writes.

import type { TimelineAudioRegionSelection, TimelineAudioRegionEditType } from '../../../stores/timeline/types';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { isAudioClip } from '../../../stores/timeline/audioEdit/audioEditHelpers';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
  resolveTimelineAudioRegionSelection,
} from '../../timeline/utils/audioEditSelection';

/** Smallest range the phone makes (seconds of timeline); the editor refuses empty ranges. */
export const PHONE_REGION_MIN_SECONDS = 0.01;

export type PhoneRegionTarget =
  | { kind: 'ready'; clip: TimelineClip; locked: boolean; viaLinkedVideo: boolean }
  | { kind: 'none'; reason: string };

/**
 * The audio clip the sheet edits: the selected audio clip, or the linked sound of a selected video.
 * Returns why not otherwise (shown in the sheet, never a silent empty view).
 */
export function resolvePhoneRegionTarget(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  selectedClipIds: readonly string[],
): PhoneRegionTarget {
  const selected = selectedClipIds
    .map((id) => clips.find((clip) => clip.id === id))
    .filter((clip): clip is TimelineClip => clip !== undefined);
  if (selected.length === 0) return { kind: 'none', reason: 'Select an audio clip (or a video with sound) first, then open Sound range.' };
  for (const clip of selected) {
    if (isAudioClip(clip)) return ready(clip, tracks, false);
  }
  for (const clip of selected) {
    const linked = clip.linkedClipId ? clips.find((candidate) => candidate.id === clip.linkedClipId) : undefined;
    if (linked && isAudioClip(linked)) return ready(linked, tracks, true);
  }
  return { kind: 'none', reason: 'The selected clip has no sound of its own. Select an audio clip, or a video whose sound is linked to it.' };
}

function ready(clip: TimelineClip, tracks: readonly TimelineTrack[], viaLinkedVideo: boolean): PhoneRegionTarget {
  const locked = tracks.find((track) => track.id === clip.trackId)?.locked === true;
  return { kind: 'ready', clip, locked, viaLinkedVideo };
}

type SelectionClip = Parameters<typeof resolveTimelineAudioRegionSelection>[0]['clip'];

function selectionClip(clip: TimelineClip): SelectionClip {
  return {
    id: clip.id, trackId: clip.trackId, startTime: clip.startTime, duration: Math.max(0.001, clip.duration),
    inPoint: clip.inPoint, outPoint: clip.outPoint, reversed: clip.reversed, waveform: clip.waveform,
  };
}

/** A range between two timeline times inside the clip (order does not matter). */
export function phoneRegionFromTimes(clip: TimelineClip, a: number, b: number): TimelineAudioRegionSelection {
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + Math.max(0.001, clip.duration);
  let start = Math.max(clipStart, Math.min(clipEnd, Math.min(a, b)));
  let end = Math.max(clipStart, Math.min(clipEnd, Math.max(a, b)));
  if (end - start < PHONE_REGION_MIN_SECONDS) {
    end = Math.min(clipEnd, start + PHONE_REGION_MIN_SECONDS);
    start = Math.max(clipStart, end - PHONE_REGION_MIN_SECONDS);
  }
  return resolveTimelineAudioRegionSelection({ clip: selectionClip(clip), anchorTimelineTime: start, focusTimelineTime: end, snapThresholdSeconds: 0 });
}

/** Whole clip. */
export function phoneRegionAll(clip: TimelineClip): TimelineAudioRegionSelection {
  return phoneRegionFromTimes(clip, clip.startTime, clip.startTime + clip.duration);
}

/** Shifts the range by a timeline delta without moving the clip (clamped to the clip). */
export function phoneRegionMoved(clip: TimelineClip, selection: TimelineAudioRegionSelection, deltaSeconds: number): TimelineAudioRegionSelection {
  return moveTimelineAudioRegionSelection({ clip: selectionClip(clip), selection, deltaTimelineSeconds: deltaSeconds });
}

/** Moves one edge to a timeline time (the other edge stays). */
export function phoneRegionResized(
  clip: TimelineClip,
  selection: TimelineAudioRegionSelection,
  edge: 'left' | 'right',
  timelineTime: number,
): TimelineAudioRegionSelection {
  return resizeTimelineAudioRegionSelection({ clip: selectionClip(clip), selection, edge, focusTimelineTime: timelineTime, snapThresholdSeconds: 0 });
}

/** Timeline time under an x position of the waveform strip. */
export function phoneRegionTimeAt(clip: TimelineClip, x: number, width: number): number {
  const ratio = Math.max(0, Math.min(1, x / Math.max(1, width)));
  return clip.startTime + ratio * Math.max(0.001, clip.duration);
}

/** Left and width of the range in percent of the strip. */
export function phoneRegionPercent(clip: TimelineClip, selection: TimelineAudioRegionSelection): { left: number; width: number } {
  const duration = Math.max(0.001, clip.duration);
  const left = ((selection.startTime - clip.startTime) / duration) * 100;
  const width = ((selection.endTime - selection.startTime) / duration) * 100;
  return { left: Math.max(0, Math.min(100, left)), width: Math.max(0, Math.min(100 - Math.max(0, left), width)) };
}

/** True when the store's selection belongs to this clip and is not empty. */
export function isPhoneRegionOf(clip: TimelineClip | null, selection: TimelineAudioRegionSelection | null): selection is TimelineAudioRegionSelection {
  return Boolean(clip && selection && selection.clipId === clip.id && selection.endTime - selection.startTime > 0.0005);
}

export type PhoneRegionChannel = 'both' | 'left' | 'right';

/** Commands that are themselves about channels ignore the channel choice. */
const CHANNEL_COMMANDS = new Set<TimelineAudioRegionEditType>(['swap-channels', 'mono-sum', 'split-stereo']);

/** Channel mask for an edit command: undefined means every channel. */
export function phoneRegionChannelMask(channel: PhoneRegionChannel, type: TimelineAudioRegionEditType): number[] | undefined {
  if (channel === 'both' || CHANNEL_COMMANDS.has(type)) return undefined;
  return channel === 'left' ? [0] : [1];
}

/** Seconds as m:ss.mmm (the typed fields show seconds; this is the readout). */
export function formatPhoneRegionTime(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(3).padStart(6, '0')}`;
}
