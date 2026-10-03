import type { TimelineClip, TimelineTrack } from '../../types';
import type { BeatDistributeRule } from '../../types/compositionGraph';
import type { BeatRuleActionConflict } from './beatRuleActions';

export interface BeatRulePlacement {
  memberId: string;
  clipId: string;
  startTime: number;
  trackId: string;
}

export interface BeatDistributionPlan {
  placements: BeatRulePlacement[];
  conflicts: BeatRuleActionConflict[];
  warnings: string[];
}

export function beatRuleBaseStart(rule: BeatDistributeRule, index: number): number {
  return rule.beatSnapshot[rule.params.firstBeat + index * rule.params.beatStep] + rule.params.offset;
}

/** Expand exactly the one-hop linked-pair policy used by move-clips. */
export function expandBeatRulePlacements(placements: readonly BeatRulePlacement[], clips: readonly TimelineClip[]): BeatRulePlacement[] {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const moves = new Map(placements.map(move => [move.clipId, move]));
  for (const move of placements) {
    const clip = byId.get(move.clipId);
    const linked = clip?.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    if (clip && linked && !moves.has(linked.id)) moves.set(linked.id, {
      memberId: move.memberId, clipId: linked.id, trackId: linked.trackId,
      startTime: linked.startTime + move.startTime - clip.startTime,
    });
  }
  return [...moves.values()];
}

export function validateBeatRulePlacements(placements: readonly BeatRulePlacement[], clips: readonly TimelineClip[], tracks: readonly TimelineTrack[]): BeatRuleActionConflict[] {
  const conflicts: BeatRuleActionConflict[] = [];
  const clipById = new Map(clips.map(clip => [clip.id, clip]));
  const trackById = new Map(tracks.map(track => [track.id, track]));
  const moves = new Map(placements.map(move => [move.clipId, move]));
  for (const move of placements) {
    const clip = clipById.get(move.clipId);
    const fail = (code: BeatRuleActionConflict['code'], message: string) => conflicts.push({ code, message, clipId: move.clipId, memberId: move.memberId });
    if (!clip) { fail('missing-clip', `Clip ${move.clipId} is missing.`); continue; }
    const target = trackById.get(move.trackId);
    if (!target || !trackById.has(clip.trackId)) fail('invalid', 'The source or target track is missing.');
    if (!Number.isFinite(move.startTime) || move.startTime < 0 || !Number.isFinite(clip.duration) || clip.duration <= 0) fail('invalid', 'Placement must have a finite nonnegative start and positive duration.');
    if (('locked' in clip && clip.locked === true) || target?.locked || trackById.get(clip.trackId)?.locked) fail('locked', `Unlock ${clip.name ?? clip.id} and its source and target tracks first.`);
    if (clip.transitionIn || clip.transitionOut) fail('transition', `Remove transitions from ${clip.name ?? clip.id} before distributing it.`);
    const sourceType = clip.source?.type;
    const expected = sourceType === 'audio' ? 'audio' : sourceType === 'midi' ? 'midi' : sourceType === 'score' ? 'score' : 'video';
    if (sourceType && target && target.type !== expected) fail('invalid', `Track ${target.name} is incompatible with ${clip.name ?? clip.id}.`);
    for (const other of clips) {
      if (other.id === clip.id) continue;
      const otherMove = moves.get(other.id);
      if ((otherMove?.trackId ?? other.trackId) !== move.trackId) continue;
      // Report each moved/moved collision once; stationary collisions once per member.
      if (otherMove && other.id < clip.id) continue;
      const start = otherMove?.startTime ?? other.startTime;
      if (move.startTime < start + other.duration - 1e-9 && start < move.startTime + clip.duration - 1e-9) fail('overlap', `${clip.name ?? clip.id} overlaps ${other.name ?? other.id} on the target track.`);
    }
  }
  return conflicts;
}

/** No store, artifact access, rounding, or mutation: times are timeline seconds. */
export function planBeatDistribution(rule: BeatDistributeRule, clips: readonly TimelineClip[], tracks: readonly TimelineTrack[]): BeatDistributionPlan {
  const conflicts: BeatRuleActionConflict[] = [];
  const { firstBeat, beatStep, offset, targetTrackId } = rule.params;
  if (rule.status.state === 'locked' || rule.operator !== 'beat-distribute' || rule.schemaVersion !== 1) conflicts.push({ code: 'rule-locked', message: 'This rule is read-only.' });
  if (!Number.isSafeInteger(firstBeat) || firstBeat < 0 || !Number.isSafeInteger(beatStep) || beatStep < 1 || !Number.isFinite(offset) || !targetTrackId
    || rule.beatSnapshot.some((beat, index, beats) => !Number.isFinite(beat) || beat < 0 || (index > 0 && beat < beats[index - 1]))
    || new Set(rule.members.map(member => member.memberId)).size !== rule.members.length
    || new Set(rule.members.map(member => member.clipId)).size !== rule.members.length
    || rule.members.some(member => !member.memberId || !member.clipId || !Number.isFinite(member.correction?.startOffset ?? 0))) {
    conflicts.push({ code: 'invalid', message: 'Invalid beat indices, snapshot, members, or correction.' });
  }
  if (conflicts.length) return { placements: [], conflicts, warnings: [] };
  if (rule.members.length && firstBeat + (rule.members.length - 1) * beatStep >= rule.beatSnapshot.length) return {
    placements: [], conflicts: [{ code: 'too-few-beats', message: 'The beat source has too few beats for this member order and step.' }], warnings: [],
  };
  const placements = rule.members.map((member, index) => ({
    memberId: member.memberId, clipId: member.clipId,
    startTime: beatRuleBaseStart(rule, index) + (member.correction?.startOffset ?? 0),
    trackId: member.correction?.trackId ?? targetTrackId,
  }));
  const expanded = expandBeatRulePlacements(placements, clips);
  conflicts.push(...validateBeatRulePlacements(expanded, clips, tracks));
  return { placements: conflicts.length ? [] : placements, conflicts, warnings: [] };
}
