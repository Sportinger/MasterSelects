// Public beat-rule actions. Artifact reads precede the synchronous undoable edit.

import type { BeatDistributeRuleParams, BeatRuleSource } from '../../types/compositionGraph';
import type { BeatDistributeRule, CompositionGraphState } from '../../types/compositionGraph';
import { useTimelineStore } from '../../stores/timeline';
import { startBatch, endBatch, cancelHistoryBatch } from '../../stores/historyStore';
import { assertExclusiveTimelineMutationAllowed } from '../../stores/timeline/exclusiveMutationLease';
import { applyMoveClipsOperation } from '../../stores/timeline/editOperations/moveOperations';
import { pruneInvalidClipTransitions } from '../../stores/timeline/editOperations/transitionOperations';
import { synchronizeSharedSceneGraphs } from '../../stores/timeline/sharedSceneGraphSynchronization';
import { planBeatDistribution, expandBeatRulePlacements, validateBeatRulePlacements } from './beatRulePlanning';
import { beatRuleCorrection, governedClipIds, isBeatDistributeRule } from './beatRuleOwnership';
import { beatRuleSourceRevision, resolveBeatRuleSource } from './beatRuleSource';
import { getEditorRepositorySession } from '../project/repository/transaction/editorMutationRuntime';
import { finishEditorGesture, runEditorGesture } from '../project/repository/transaction/editorGestureOwnership';

export { planBeatDistribution } from './beatRulePlanning';

export interface BeatRuleActionConflict {
  code: 'too-few-beats' | 'overlap' | 'locked' | 'transition' | 'missing-clip' | 'missing-source' | 'stale' | 'rule-locked' | 'invalid';
  message: string;
  clipId?: string;
  memberId?: string;
}

export interface BeatRuleActionResult {
  success: boolean;
  ruleId?: string;
  changedClipIds: string[];
  conflicts: BeatRuleActionConflict[];
  warnings: string[];
}

export interface CreateBeatRuleRequest {
  /** Ordered clip ids; order determines beat assignment. */
  clipIds: string[];
  source: BeatRuleSource;
  params?: Partial<BeatDistributeRuleParams>;
  label?: string;
}

const failure = (code: BeatRuleActionConflict['code'], message: string, ruleId?: string): BeatRuleActionResult => ({
  success: false, ruleId, changedClipIds: [], conflicts: [{ code, message }], warnings: [],
});
const success = (ruleId: string): BeatRuleActionResult => ({ success: true, ruleId, changedClipIds: [], conflicts: [], warnings: [] });
const getRule = (id: string) => {
  const rule = useTimelineStore.getState().compositionGraph?.rules?.[id];
  return isBeatDistributeRule(rule) && rule.status.state !== 'locked' ? rule : undefined;
};
const writeRule = (rule: BeatDistributeRule) => useTimelineStore.getState().updateCompositionGraph((graph: CompositionGraphState | undefined) => ({
  ...graph, version: 1, rules: { ...graph?.rules, [rule.id]: rule },
}));

/** Synchronous: no UI task or asynchronous artifact read can interleave the batch. */
function transaction(ruleId: string, label: string, apply: () => BeatRuleActionResult): BeatRuleActionResult {
  const before = useTimelineStore.getState();
  if (before.isExporting) return failure('locked', 'Editing is unavailable during export.', ruleId);
  try { assertExclusiveTimelineMutationAllowed(); } catch (error) { return failure('locked', String(error), ruleId); }
  let batch;
  try { batch = startBatch(label); } catch (error) { return failure('locked', String(error), ruleId); }
  const repository = getEditorRepositorySession();
  const run = <T,>(action: () => T): T => repository && batch.batchId !== null ? runEditorGesture(batch.batchId, action) : action();
  const restore = () => run(() => useTimelineStore.setState({ ...before, compositionGraph: before.compositionGraph }));
  const cancel = () => {
    if (!batch.opened) return;
    if (repository && batch.batchId !== null) finishEditorGesture(batch.batchId, true);
    cancelHistoryBatch();
  };
  const rollback = () => {
    // Repository cancellation restores all touched domains, including composition projections.
    if (repository && batch.opened) { cancel(); return; }
    restore();
    cancel();
  };
  try {
    const result = run(apply);
    if (!result.success) {
      rollback();
      return result;
    }
    if (batch.opened) {
      // Programmatic nested startBatch calls may clear history's scalar batch id.
      // Pin and finish our repository gesture explicitly, then close the facade.
      if (repository && batch.batchId !== null) finishEditorGesture(batch.batchId);
      endBatch();
    }
    return result;
  } catch (error) {
    // Preserve an enclosing gesture; only cancel the history batch we opened.
    rollback();
    return failure('invalid', error instanceof Error ? error.message : String(error), ruleId);
  }
}

function applyRule(rule: BeatDistributeRule): BeatRuleActionResult {
  const state = useTimelineStore.getState();
  const plan = planBeatDistribution(rule, state.clips, state.tracks);
  if (plan.conflicts.length) return { ...success(rule.id), success: false, conflicts: plan.conflicts };
  const expanded = expandBeatRulePlacements(plan.placements, state.clips);
  const otherOwners = governedClipIds({ version: 1, rules: Object.fromEntries(Object.entries(state.compositionGraph?.rules ?? {}).filter(([id]) => id !== rule.id)) });
  if (expanded.some(move => otherOwners.has(move.clipId))) return failure('invalid', 'A member or linked clip is already governed by another rule.', rule.id);
  const source = rule.source;
  if (source.kind === 'clip-beat-grid' && expanded.some(move => move.clipId === source.clipId)) return failure('invalid', 'The beat source cannot also be moved by its own rule.', rule.id);
  const operation = { id: `beat-rule:${rule.id}`, type: 'move-clips' as const, moves: plan.placements, includeLinked: true };
  // move-clips accepts valid subsets: preflight its exact rounding and validation before any write.
  const preview = applyMoveClipsOperation(operation, state.clips, state.tracks);
  const rejected = preview.warnings.filter(warning => warning.code !== 'no-op');
  if (rejected.length) return failure('invalid', rejected.map(warning => warning.message).join(' '), rule.id);
  if (pruneInvalidClipTransitions(preview.clips).changedClipIds.length) return failure('transition', 'Resolve existing invalid transitions before distributing clips.', rule.id);
  const projected = new Map(preview.clips.map(clip => [clip.id, clip]));
  const rounded = expanded.map(move => ({ ...move, startTime: projected.get(move.clipId)!.startTime, trackId: projected.get(move.clipId)!.trackId }));
  const conflicts = validateBeatRulePlacements(rounded, state.clips, state.tracks);
  if (conflicts.length) return { ...success(rule.id), success: false, conflicts };
  try {
    const patch = synchronizeSharedSceneGraphs(state, { clips: preview.clips });
    if (patch.clips?.some(clip => clip.startTime !== projected.get(clip.id)?.startTime || clip.trackId !== projected.get(clip.id)?.trackId)) {
      return failure('invalid', 'Release shared scene outputs before distributing their source clip.', rule.id);
    }
  } catch (error) { return failure('invalid', String(error), rule.id); }
  const warnings = expanded.some((move, index) => Math.abs(move.startTime - rounded[index].startTime) > 1e-9)
    ? ['Video and linked-audio placements use the timeline frame grid.'] : [];
  return transaction(rule.id, 'Distribute clips on beats', () => {
    const result = useTimelineStore.getState().applyTimelineEditOperation(operation, { source: 'ui', historyLabel: 'Distribute clips on beats' });
    if (result.warnings.some(warning => warning.code !== 'no-op') || (!result.success && preview.changedClipIds.length > 0)) return failure('invalid', result.warnings.map(warning => warning.message).join(' ') || 'Clip move failed.', rule.id);
    if (useTimelineStore.getState().clips.some(clip => clip.startTime !== projected.get(clip.id)?.startTime || clip.trackId !== projected.get(clip.id)?.trackId)) return failure('invalid', 'The clip move differed from its validated plan.', rule.id);
    // The move guard may have rewritten corrections; replace them with the intended definition.
    const current = useTimelineStore.getState();
    const revision = beatRuleSourceRevision(rule.source, current);
    writeRule({ ...rule, status: revision !== rule.sourceRevision
      ? { state: 'stale', reason: 'Beat source changed. Refresh source to recompute.' } : { state: 'ok' } });
    return { ...success(rule.id), changedClipIds: result.changedClipIds, warnings };
  });
}

function editRule(ruleId: string, edit: (rule: BeatDistributeRule) => BeatDistributeRule): BeatRuleActionResult {
  const rule = getRule(ruleId);
  if (!rule) return failure('rule-locked', 'Rule is missing or read-only.', ruleId);
  if (rule.status.state === 'stale' || beatRuleSourceRevision(rule.source, useTimelineStore.getState()) !== rule.sourceRevision) {
    return markStale(rule, 'Beat source changed or is missing. Refresh source before applying changes.');
  }
  return applyRule(edit(rule));
}

function markStale(rule: BeatDistributeRule, reason: string): BeatRuleActionResult {
  const result = transaction(rule.id, 'Mark beat source stale', () => {
    writeRule({ ...rule, status: { state: 'stale', reason } });
    return success(rule.id);
  });
  return result.success ? failure('stale', reason, rule.id) : result;
}

export async function createBeatRule(request: CreateBeatRuleRequest): Promise<BeatRuleActionResult> {
  const state = useTimelineStore.getState();
  if (!request.clipIds.length || new Set(request.clipIds).size !== request.clipIds.length) return failure('invalid', 'Choose a nonempty selection of distinct clips.');
  let resolved;
  try { resolved = await resolveBeatRuleSource(request.source, state); } catch { return failure('missing-source', 'The beat artifact could not be loaded.'); }
  if (!resolved) return failure('missing-source', 'The beat source is missing.');
  if (useTimelineStore.getState().timelineRevision !== state.timelineRevision || useTimelineStore.getState().clips !== state.clips
    || beatRuleSourceRevision(request.source, useTimelineStore.getState()) !== resolved.sourceRevision) return failure('stale', 'Timeline changed while loading beats. Try again.');
  const rule: BeatDistributeRule = {
    id: crypto.randomUUID(), operator: 'beat-distribute', schemaVersion: 1, label: request.label ?? 'Distribute on beats',
    members: request.clipIds.map(clipId => ({ memberId: crypto.randomUUID(), clipId, mediaFileId: state.clips.find(clip => clip.id === clipId)?.mediaFileId })),
    params: { firstBeat: 0, beatStep: 1, offset: 0, targetTrackId: state.clips.find(clip => clip.id === request.clipIds[0])?.trackId ?? '', ...request.params },
    ...resolved, status: { state: 'ok' },
  };
  return applyRule(rule);
}

export function updateBeatRuleParams(ruleId: string, params: Partial<BeatDistributeRuleParams>): BeatRuleActionResult {
  return editRule(ruleId, rule => ({ ...rule, params: { ...rule.params, ...params } }));
}

export function reorderBeatRuleMembers(ruleId: string, memberIds: string[]): BeatRuleActionResult {
  const rule = getRule(ruleId);
  if (!rule) return failure('rule-locked', 'Rule is missing or read-only.', ruleId);
  if (memberIds.length !== rule.members.length || new Set(memberIds).size !== memberIds.length || memberIds.some(id => !rule.members.some(member => member.memberId === id))) return failure('invalid', 'Supply every member identity exactly once.', ruleId);
  return editRule(ruleId, current => ({ ...current, members: memberIds.map(id => current.members.find(member => member.memberId === id)!) }));
}

export function resetBeatRuleMemberCorrection(ruleId: string, memberId: string): BeatRuleActionResult {
  const rule = getRule(ruleId);
  if (!rule?.members.some(member => member.memberId === memberId)) return failure('invalid', 'Member is missing.', ruleId);
  return editRule(ruleId, current => ({ ...current, members: current.members.map(member => member.memberId === memberId ? { ...member, correction: undefined } : member) }));
}

export function releaseBeatRuleMember(ruleId: string, memberId: string): BeatRuleActionResult {
  const rule = getRule(ruleId);
  if (!rule) return failure('rule-locked', 'Rule is missing or read-only.', ruleId);
  if (!rule.members.some(member => member.memberId === memberId)) return failure('invalid', 'Member is missing.', ruleId);
  return transaction(ruleId, 'Release beat rule member', () => {
    const clips = useTimelineStore.getState().clips;
    writeRule({ ...rule, members: rule.members.filter(member => member.memberId !== memberId).map((member, index) => {
      const clip = clips.find(candidate => candidate.id === member.clipId);
      return clip ? { ...member, correction: beatRuleCorrection(rule, index, clip) } : member;
    }) });
    return success(ruleId);
  });
}

export function materializeBeatRule(ruleId: string): BeatRuleActionResult {
  if (!getRule(ruleId)) return failure('rule-locked', 'Rule is missing or read-only.', ruleId);
  return transaction(ruleId, 'Materialize beat rule', () => {
    useTimelineStore.getState().updateCompositionGraph((graph: CompositionGraphState | undefined) => {
      const rules = { ...graph?.rules };
      delete rules[ruleId];
      return { ...graph, version: 1, rules };
    });
    return success(ruleId);
  });
}

/** A source change is explicit; it never runs as a consequence of rendering the inspector. */
export async function setBeatRuleSource(ruleId: string, source: BeatRuleSource): Promise<BeatRuleActionResult> {
  const rule = getRule(ruleId);
  if (!rule) return failure('rule-locked', 'Rule is missing or read-only.', ruleId);
  const state = useTimelineStore.getState();
  let resolved;
  try { resolved = await resolveBeatRuleSource(source, state); } catch { resolved = null; }
  const current = useTimelineStore.getState();
  if (current.timelineRevision !== state.timelineRevision || current.clips !== state.clips || getRule(ruleId) !== rule) return failure('stale', 'Timeline changed while loading beats. Try again.', ruleId);
  if (!resolved) return markStale(rule, 'Beat source is missing. Stored clip positions are preserved.');
  if (beatRuleSourceRevision(source, current) !== resolved.sourceRevision) return markStale(rule, 'Beat source changed while loading. Try again.');
  return applyRule({ ...rule, ...resolved, status: { state: 'ok' } });
}

export async function refreshBeatRuleSource(ruleId: string): Promise<BeatRuleActionResult> {
  const rule = getRule(ruleId);
  return rule ? setBeatRuleSource(ruleId, rule.source) : failure('rule-locked', 'Rule is missing or read-only.', ruleId);
}
