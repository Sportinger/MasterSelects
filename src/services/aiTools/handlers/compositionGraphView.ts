import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { TimelineTransition } from '../../../types/timelineCore';
import type { BeatRuleMemberCorrection, CompositionGraphState } from '../../../types/compositionGraph';
import { beatRuleSourceRevision, type BeatRuleSourceState } from '../../compositionRules/beatRuleSource';
import { isBeatDistributeRule } from '../../compositionRules/beatRuleOwnership';
import { compositionMediaId } from '../../nodeGraph/composition/compositionGraphMedia';

export interface CompositionGraphViewInput extends BeatRuleSourceState {
  tracks: readonly TimelineTrack[];
  compositionGraph?: CompositionGraphState;
  compositionId: string | null;
  media: ReadonlyMap<string, { name: string; duration?: number }>;
}

export interface CompositionGraphViewOptions {
  trackIds?: string[];
  timeRange?: { start: number; end: number };
  limit?: number;
}

export const COMPOSITION_GRAPH_MAX_CHARACTERS = 350_000;
const label = (value: string | undefined) => value?.slice(0, 200);
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const correction = (value: BeatRuleMemberCorrection | undefined) => value ? {
  startOffset: value.startOffset, trackId: value.trackId,
} : undefined;

function beatGridSummary(clip: TimelineClip) {
  const job = clip.audioAnalysisJob;
  const analyzing = job?.kind === 'beat-onset-analysis'
    && !['complete', 'cancelled', 'failed'].includes(job.phase);
  return {
    ...(clip.audioState?.sourceAnalysisRefs?.beatGridId ? { source: true as const } : {}),
    ...(clip.audioState?.processedAnalysisRefs?.beatGridId ? { processed: true as const } : {}),
    ...(analyzing ? { analyzing: Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0 } : {}),
  };
}

/** Pure projection: never resolves artifacts, builds clip graphs, or opens transition bodies. */
export function projectCompositionGraphView(input: CompositionGraphViewInput, options: CompositionGraphViewOptions = {}) {
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 200)));
  const trackIds = options.trackIds ? new Set(options.trackIds) : undefined;
  const range = options.timeRange;
  const matching = input.clips.filter(clip => (!trackIds || trackIds.has(clip.trackId))
    && (!range || (clip.startTime < range.end && clip.startTime + clip.duration > range.start)))
    .toSorted((a, b) => a.startTime - b.startTime || byId(a, b));
  const selected = matching.slice(0, limit);
  const selectedIds = new Set(selected.map(clip => clip.id));
  const definitions = Object.values(input.compositionGraph?.rules ?? {}).toSorted(byId);
  const ownership = new Map<string, { ruleId: string; memberId: string; correction?: BeatRuleMemberCorrection }>();
  for (const rule of definitions) if (isBeatDistributeRule(rule)) {
    for (const member of rule.members) if (selectedIds.has(member.clipId)) {
      ownership.set(member.clipId, { ruleId: rule.id, memberId: member.memberId, correction: correction(member.correction) });
    }
  }

  // One shared character budget bounds even unusual IDs, labels and many empty rules.
  let remaining = COMPOSITION_GRAPH_MAX_CHARACTERS - 4000;
  function bounded<T>(rows: readonly T[], maximum: number): T[] {
    const result: T[] = [];
    for (const row of rows.slice(0, maximum)) {
      const size = JSON.stringify(row).length + 1;
      if (size > remaining) break;
      result.push(row);
      remaining -= size;
    }
    return result;
  }
  const matchingTracks = input.tracks.filter(track => !trackIds || trackIds.has(track.id));
  // Preserve compositor order for tracks; clips are ordered by timeline start, then stable ID.
  const tracks = bounded(matchingTracks.map(track => ({ id: track.id, name: label(track.name), type: track.type,
    locked: !!track.locked, muted: !!track.muted, visible: track.visible !== false, solo: !!track.solo })), 1000);
  const clips = bounded(selected.map(clip => ({
    id: clip.id, name: label(clip.name), trackId: clip.trackId, start: clip.startTime, duration: clip.duration,
    inPoint: clip.inPoint, outPoint: clip.outPoint, speed: clip.speed ?? 1,
    reversed: !!clip.reversed || (clip.speed ?? 1) < 0, linkedClipId: clip.linkedClipId,
    mediaId: compositionMediaId(clip), isComposition: !!clip.isComposition, compositionId: clip.compositionId,
    transitionIn: clip.transitionIn?.id, transitionOut: clip.transitionOut?.id, ...ownership.get(clip.id),
    beatGrid: beatGridSummary(clip),
  })), limit);
  const includedIds = new Set(clips.map(clip => clip.id));
  const usedMedia = new Set(clips.map(clip => clip.mediaId));
  const mediaSources = new Map<string, { clip: TimelineClip; pieceCount: number }>();
  for (const clip of input.clips) {
    const id = compositionMediaId(clip);
    if (!usedMedia.has(id)) continue;
    const existing = mediaSources.get(id);
    if (existing) existing.pieceCount++;
    else mediaSources.set(id, { clip, pieceCount: 1 });
  }
  const media = bounded([...mediaSources].toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([mediaId, { clip, pieceCount }]) => ({ mediaId,
      name: label(input.media.get(mediaId)?.name ?? clip.name),
      duration: input.media.get(mediaId)?.duration ?? clip.source?.naturalDuration ?? null, pieceCount,
    })), 1000);
  const relations = new Map<string, { transition: TimelineTransition; outgoingClipId: string; incomingClipId: string }>();
  // Match the UI projection's preference for outgoing transition records.
  for (const clip of input.clips) if (clip.transitionOut) relations.set(clip.transitionOut.id,
    { transition: clip.transitionOut, outgoingClipId: clip.id, incomingClipId: clip.transitionOut.linkedClipId });
  for (const clip of input.clips) if (clip.transitionIn && !relations.has(clip.transitionIn.id)) relations.set(clip.transitionIn.id,
    { transition: clip.transitionIn, outgoingClipId: clip.transitionIn.linkedClipId, incomingClipId: clip.id });
  const matchingTransitions = [...relations.values()]
    .filter(item => includedIds.has(item.outgoingClipId) || includedIds.has(item.incomingClipId))
    .map(({ transition, outgoingClipId, incomingClipId }) => ({ id: transition.id, type: transition.type,
      duration: transition.duration, offset: transition.offset ?? 0, outgoingClipId, incomingClipId,
      hasComposition: !!transition.compositionId } )).toSorted(byId);
  const transitions = bounded(matchingTransitions, 2000);
  const matchingRules = definitions.filter(rule => !trackIds && !range || (isBeatDistributeRule(rule)
    && rule.members.some(member => includedIds.has(member.clipId))));
  let memberBudget = 1000;
  const ruleRows = matchingRules.slice(0, 200).map(rule => {
    if (!isBeatDistributeRule(rule)) return { id: rule.id, operator: label(rule.operator), label: label(rule.label),
      status: { state: 'locked', reason: 'Unsupported rule operator or schema version.' } };
    const members = rule.members.slice(0, memberBudget).map(member => ({ memberId: member.memberId,
      clipId: member.clipId, correction: correction(member.correction) }));
    memberBudget -= members.length;
    return { id: rule.id, operator: rule.operator, label: label(rule.label),
      status: rule.status.state === 'ok' ? { state: 'ok' } : { state: rule.status.state, reason: label(rule.status.reason) },
      params: { firstBeat: rule.params.firstBeat, beatStep: rule.params.beatStep,
        offset: rule.params.offset, targetTrackId: rule.params.targetTrackId },
      source: rule.source.kind === 'tempo-map' ? { kind: 'tempo-map' } : { kind: 'clip-beat-grid',
        clipId: rule.source.clipId, provenance: rule.source.provenance, artifactId: rule.source.artifactId },
      members, memberCount: rule.members.length, omittedMemberCount: rule.members.length - members.length,
      beatCount: rule.beatSnapshot.length,
      stale: rule.status.state === 'stale' || beatRuleSourceRevision(rule.source, input) !== rule.sourceRevision,
    };
  });
  const rules = bounded(ruleRows, 200);
  const omitted = { clips: matching.length - clips.length, tracks: matchingTracks.length - tracks.length,
    media: mediaSources.size - media.length, transitions: matchingTransitions.length - transitions.length,
    rules: matchingRules.length - rules.length,
    ruleMembers: rules.reduce((count, rule) => count + (rule.omittedMemberCount ?? 0), 0) };
  return { compositionId: input.compositionId, tracks, clips, media, transitions, rules,
    truncation: { truncated: Object.values(omitted).some(count => count > 0), omitted,
      totalClipCount: input.clips.length, matchingClipCount: matching.length, limit,
      characterBudget: COMPOSITION_GRAPH_MAX_CHARACTERS } };
}
