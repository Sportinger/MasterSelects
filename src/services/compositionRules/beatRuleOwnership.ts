import type { TimelineClip } from '../../types';
import type { BeatDistributeRule, CompositionGraphState, UnknownCompositionRule } from '../../types/compositionGraph';
import type { TimelineEditWarning } from '../../stores/timeline/editOperations/types';
import { beatRuleBaseStart } from './beatRulePlanning';

export function isBeatDistributeRule(rule: BeatDistributeRule | UnknownCompositionRule | undefined): rule is BeatDistributeRule {
  return rule?.operator === 'beat-distribute' && rule.schemaVersion === 1 && Array.isArray(rule.members)
    && Array.isArray(rule.beatSnapshot) && !!rule.params && !!rule.status;
}

export function beatRuleCorrection(rule: BeatDistributeRule, index: number, clip: TimelineClip) {
  const startOffset = clip.startTime - beatRuleBaseStart(rule, index);
  return {
    ...(Number.isFinite(startOffset) && startOffset !== 0 ? { startOffset } : {}),
    ...(clip.trackId !== rule.params.targetTrackId ? { trackId: clip.trackId } : {}),
  };
}

/** Also protect preserved unknown rule definitions when their member ids are readable. */
export function governedClipIds(graph: CompositionGraphState | undefined): Set<string> {
  const ids = new Set<string>();
  for (const rule of Object.values(graph?.rules ?? {})) {
    if (!Array.isArray(rule.members)) continue;
    for (const member of rule.members) if (member && typeof member === 'object' && typeof member.clipId === 'string') ids.add(member.clipId);
  }
  return ids;
}

export function compositionRuleSplitWarning(graph: CompositionGraphState | undefined, clips: readonly TimelineClip[], clipIds: readonly string[], includeLinked = true): TimelineEditWarning | undefined {
  if (!graph?.rules) return;
  const governed = governedClipIds(graph);
  const requested = new Set(clipIds);
  if (includeLinked) for (const clip of clips) if (requested.has(clip.id) && clip.linkedClipId) requested.add(clip.linkedClipId);
  const clipId = [...requested].find(id => governed.has(id));
  return clipId ? { code: 'unsupported', clipId, message: 'This clip is governed by a composition rule. Release it from the rule before splitting.' } : undefined;
}
