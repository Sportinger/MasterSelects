import type { TimelineStore } from './types';
import { beatRuleCorrection, isBeatDistributeRule } from '../../services/compositionRules/beatRuleOwnership';
import { beatRuleSourceRevision } from '../../services/compositionRules/beatRuleSource';

/**
 * Rewrite ownership in the same patch as the clip edit, before history capture.
 */
export function synchronizeCompositionRules(state: TimelineStore, patch: Partial<TimelineStore>): Partial<TimelineStore> {
  const graph = state.compositionGraph;
  if (!graph?.rules || Object.keys(graph.rules).length === 0 || 'compositionGraph' in patch || (!patch.clips && !patch.tempoMap && patch.duration === undefined)) return patch;
  let rules = graph.rules;
  const before = new Map(state.clips.map(clip => [clip.id, clip]));
  const after = new Map((patch.clips ?? state.clips).map(clip => [clip.id, clip]));
  for (const rule of Object.values(graph.rules)) {
    if (!isBeatDistributeRule(rule) || rule.status.state === 'locked') continue;
    let changed = false;
    const surviving = rule.members.filter(member => after.has(member.clipId));
    const removed = surviving.length !== rule.members.length;
    const members = surviving.map((member, index) => {
      const old = before.get(member.clipId), clip = after.get(member.clipId)!;
      if (!removed && old?.startTime === clip.startTime && old?.trackId === clip.trackId) return member;
      changed = true;
      // Rebase after removal too: no remaining member jumps when it is refreshed later.
      return { ...member, correction: beatRuleCorrection(rule, index, clip) };
    });
    const revision = beatRuleSourceRevision(rule.source, { ...state, ...patch });
    const stale = revision !== rule.sourceRevision;
    const reason = revision === undefined ? 'Beat source is missing. Stored clip positions are preserved.' : 'Beat source changed. Refresh source to recompute.';
    const statusChanged = stale && (rule.status.state !== 'stale' || rule.status.reason !== reason);
    if (changed || removed || statusChanged) rules = { ...rules, [rule.id]: {
      ...rule, members,
      ...(statusChanged ? { status: { state: 'stale' as const, reason } } : {}),
    } };
  }
  // Empty rules are retained so their source, settings and identity remain inspectable.
  return rules === graph.rules ? patch : { ...patch, compositionGraph: { ...graph, rules } };
}
