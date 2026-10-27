// The trim modes sheet's edits, each one call of the editor's own timeline edit operations
// (ripple-trim-edge-to-time, rolling-edit, slip-clip, slide-clip, delete-all-gaps) or link actions,
// so a phone edit is identical to the desktop one. Steppers SET a target offset from a baseline
// captured when the mode is first used; every call reads fresh store state. Each returns a phone
// result whose message says when the editor clamped or refused the edit (no silent failure).

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineEditOperation } from '../../../stores/timeline/editOperations/types';
import type { TimelineClip } from '../../../types/timeline';
import { phoneResultFromEdit } from '../actions/phoneClipEditActions';
import type { PhoneActionResult } from '../contracts';
import {
  clampToRange, phoneLinkCandidate, phoneRippleTrimReason, phoneRollRange, phoneSlideRange, phoneSlipRange, phoneTrimNeighbours,
} from './phoneTrimPlans';

let sequence = 0;
const nextId = (kind: string) => `phone-${kind}:${++sequence}:${Date.now()}`;
const EPSILON = 1e-6;

type Operation = TimelineEditOperation;

function apply(operation: Operation, label: string, fallback: string): PhoneActionResult {
  const store = useTimelineStore.getState();
  if (store.isExporting) return { ok: false, message: `${label} is unavailable while an export is running.` };
  try {
    return phoneResultFromEdit(store.applyTimelineEditOperation(operation, { source: 'ui', historyLabel: label }), fallback);
  } catch (error) {
    return { ok: false, message: `${label} failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function clipById(clipId: string): TimelineClip | null {
  return useTimelineStore.getState().clips.find((clip) => clip.id === clipId) ?? null;
}

const gone: PhoneActionResult = { ok: false, message: 'The clip no longer exists.' };

/** Cuts the clip's start or end at the playhead and closes the gap (later clips move). */
export function phoneRippleTrim(clipId: string, edge: 'start' | 'end'): PhoneActionResult {
  const clip = clipById(clipId);
  if (!clip) return gone;
  const playhead = useTimelineStore.getState().playheadPosition;
  const reason = phoneRippleTrimReason(clip, playhead);
  if (reason) return { ok: false, message: reason };
  return apply({ id: nextId('ripple'), type: 'ripple-trim-edge-to-time', edge, time: playhead, clipIds: [clipId], includeLinked: true },
    'Ripple trim', 'The clip could not be ripple-trimmed here.');
}

export interface PhoneOffsetResult { result: PhoneActionResult; clamped: boolean }

/** Moves the cut at the clip's start or end to `base + offset` (seconds) with its neighbour. */
export function phoneRollTo(clipId: string, side: 'start' | 'end', base: number, offset: number): PhoneOffsetResult {
  const state = useTimelineStore.getState();
  const clip = clipById(clipId);
  if (!clip) return { result: gone, clamped: false };
  const neighbours = phoneTrimNeighbours(state.clips, clip);
  const left = side === 'start' ? neighbours.previous : clip;
  const right = side === 'start' ? clip : neighbours.next;
  if (!left || !right) return { result: { ok: false, message: side === 'start' ? 'No clip touches this clip\'s start.' : 'No clip touches this clip\'s end.' }, clamped: false };
  const cut = right.startTime;
  const range = phoneRollRange(left, right);
  const wanted = base + offset;
  const target = clampToRange(wanted - cut, range) + cut;
  if (Math.abs(target - cut) <= EPSILON) return { result: { ok: true }, clamped: Math.abs(wanted - target) > EPSILON };
  const result = apply({ id: nextId('roll'), type: 'rolling-edit', clipId, edge: side, time: target, includeLinked: true },
    'Rolling edit', 'The cut could not be moved.');
  return { result, clamped: Math.abs(wanted - target) > EPSILON };
}

/** Shows other footage in the clip: in point = `base + offset`, position and length stay. */
export function phoneSlipTo(clipId: string, base: number, offset: number): PhoneOffsetResult {
  const clip = clipById(clipId);
  if (!clip) return { result: gone, clamped: false };
  const range = phoneSlipRange(clip);
  const wanted = base + offset;
  const delta = clampToRange(wanted - clip.inPoint, range);
  const clamped = Math.abs(clip.inPoint + delta - wanted) > EPSILON;
  if (Math.abs(delta) <= EPSILON) return { result: { ok: true }, clamped };
  return { result: apply({ id: nextId('slip'), type: 'slip-clip', clipId, sourceDelta: delta, includeLinked: true }, 'Slip clip', 'The clip could not be slipped.'), clamped };
}

/** Moves the clip to start at `base + offset` between its neighbours; their outer cuts stay. */
export function phoneSlideTo(clipId: string, base: number, offset: number): PhoneOffsetResult {
  const state = useTimelineStore.getState();
  const clip = clipById(clipId);
  if (!clip) return { result: gone, clamped: false };
  const range = phoneSlideRange(phoneTrimNeighbours(state.clips, clip));
  if (!range) return { result: { ok: false, message: 'Slide needs a clip touching each side of this one.' }, clamped: false };
  const wanted = base + offset;
  const delta = clampToRange(wanted - clip.startTime, range);
  const clamped = Math.abs(clip.startTime + delta - wanted) > EPSILON;
  if (Math.abs(delta) <= EPSILON) return { result: { ok: true }, clamped };
  return { result: apply({ id: nextId('slide'), type: 'slide-clip', clipId, timelineDelta: delta, includeLinked: true }, 'Slide clip', 'The clip could not be slid.'), clamped };
}

/** Closes every gap on the clip's track. */
export function phoneCloseTrackGaps(clipId: string): PhoneActionResult {
  const clip = clipById(clipId);
  if (!clip) return gone;
  return apply({ id: nextId('gaps'), type: 'delete-all-gaps', trackIds: [clip.trackId] }, 'Close gaps', 'There are no gaps on this track.');
}

export function phoneUnlink(clipId: string): PhoneActionResult {
  const clip = clipById(clipId);
  if (!clip) return gone;
  if (!clip.linkedClipId && !clip.linkedGroupId) return { ok: false, message: 'This clip is not linked.' };
  useTimelineStore.getState().unlinkClips([clipId]);
  const after = clipById(clipId);
  if (after?.linkedClipId || after?.linkedGroupId) return { ok: false, message: 'The clips could not be unlinked (is a track locked?).' };
  return { ok: true };
}

/** Links the selected clips, or a lone clip with its best partner of the other kind. */
export function phoneLink(clipId: string, selectedIds: readonly string[]): PhoneActionResult {
  const state = useTimelineStore.getState();
  const clip = clipById(clipId);
  if (!clip) return gone;
  let ids = selectedIds.filter((id) => state.clips.some((candidate) => candidate.id === id));
  if (ids.length < 2) {
    const audioTracks = new Set(state.tracks.filter((track) => track.type === 'audio').map((track) => track.id));
    const partner = phoneLinkCandidate(state.clips, clip, audioTracks);
    if (!partner) return { ok: false, message: 'No unlinked clip of the other kind overlaps this one.' };
    ids = [clipId, partner.id];
  }
  useTimelineStore.getState().linkClips(ids);
  const after = clipById(clipId);
  if (!after?.linkedClipId && !after?.linkedGroupId) return { ok: false, message: 'The clips could not be linked (is a track locked?).' };
  return { ok: true };
}
