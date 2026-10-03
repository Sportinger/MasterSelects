import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { BeatDistributeRuleParams, BeatRuleSource } from '../../../types/compositionGraph';
import {
  createBeatRule, updateBeatRuleParams, setBeatRuleSource, refreshBeatRuleSource,
  reorderBeatRuleMembers, resetBeatRuleMemberCorrection, releaseBeatRuleMember, materializeBeatRule,
  type BeatRuleActionResult,
} from '../../compositionRules/beatRuleActions';
import { currentBeatRuleSource } from '../../compositionRules/beatRuleSource';
import { isBeatDistributeRule } from '../../compositionRules/beatRuleOwnership';
import type { ToolResult } from '../types';
import { captureMutationEntitySnapshot, describeMutationEntities } from './mutationEntityResults';
import { projectCompositionGraphView, type CompositionGraphViewOptions } from './compositionGraphView';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const validIds = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0 && value.length <= 1000 && value.every(validId) && new Set(value).size === value.length;
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function failure(message: string, ruleId?: string, code = 'invalid'): ToolResult {
  return { success: false, error: message, data: { success: false, ruleId,
    changedClipIds: [], conflicts: [{ code, message }], warnings: [] } };
}

function validParams(value: unknown): value is Partial<BeatDistributeRuleParams> {
  if (!isRecord(value) || !Object.keys(value).length || !onlyKeys(value, ['firstBeat', 'beatStep', 'offset', 'targetTrackId'])) return false;
  return Object.entries(value).every(([key, item]) => key === 'targetTrackId' ? validId(item)
    : key === 'offset' ? finite(item)
      : finite(item) && Number.isSafeInteger(item) && item >= (key === 'beatStep' ? 1 : 0));
}

function parseSource(value: unknown): BeatRuleSource | undefined {
  if (!isRecord(value)) return;
  if (value.kind === 'tempo-map' && onlyKeys(value, ['kind'])) return { kind: 'tempo-map' };
  if (value.kind !== 'clip-beat-grid' || !onlyKeys(value, ['kind', 'clipId', 'provenance'])
    || !validId(value.clipId) || (value.provenance !== 'source' && value.provenance !== 'processed')) return;
  // Artifact identity is resolved from the current timeline, never accepted from the agent.
  return currentBeatRuleSource({ kind: 'clip-beat-grid', clipId: value.clipId,
    provenance: value.provenance, artifactId: '' }, useTimelineStore.getState());
}

function ruleBound(ruleId: string): ToolResult | undefined {
  const rule = useTimelineStore.getState().compositionGraph?.rules?.[ruleId];
  if (isBeatDistributeRule(rule) && rule.members.length > 1000) return failure('This tool supports at most 1000 rule members.', ruleId);
}

async function mutate(action: () => BeatRuleActionResult | Promise<BeatRuleActionResult>): Promise<ToolResult> {
  // The shared action owns its transaction/history. No second batch or store writes here.
  const before = captureMutationEntitySnapshot('clip', useTimelineStore.getState().clips);
  const result = await action();
  const entities = describeMutationEntities(before, useTimelineStore.getState().clips, { updatedEntityIds: result.changedClipIds });
  const changedClipIds = result.changedClipIds.slice(0, 2000);
  return { success: result.success,
    // The public operation boundary forwards only `error` on failure, so it carries every conflict.
    ...(!result.success ? { error: result.conflicts.map(conflict => `${conflict.code}: ${conflict.message}`)
      .join(' | ').slice(0, 500) || 'Beat rule action failed.' } : {}),
    data: { success: result.success, ruleId: result.ruleId, changedClipIds,
      conflicts: result.conflicts.slice(0, 100).map(conflict => ({ code: conflict.code,
        message: conflict.message.slice(0, 500), clipId: conflict.clipId, memberId: conflict.memberId })),
      warnings: result.warnings.slice(0, 40).map(warning => warning.slice(0, 500)),
      omitted: { changedClipIds: result.changedClipIds.length - changedClipIds.length,
        conflicts: Math.max(0, result.conflicts.length - 100), warnings: Math.max(0, result.warnings.length - 40) },
      stateRevisionBefore: entities.stateRevisionBefore, stateRevisionAfter: entities.stateRevisionAfter,
      // These actions only update existing clips; unrelated async creations/deletions are not theirs.
      entities: { created: [], deleted: [], updated: entities.entities.updated.slice(0, 2000) },
    } };
}

export async function handleGetCompositionGraph(args: Record<string, unknown>): Promise<ToolResult> {
  if (!onlyKeys(args, ['trackIds', 'timeRange', 'limit'])
    || (args.trackIds !== undefined && !validIds(args.trackIds))
    || (args.limit !== undefined && (!finite(args.limit) || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 1000))) {
    return failure('Expected distinct trackIds and an integer limit from 1 to 1000.');
  }
  if (args.timeRange !== undefined && (!isRecord(args.timeRange) || !onlyKeys(args.timeRange, ['start', 'end'])
    || !finite(args.timeRange.start) || !finite(args.timeRange.end) || args.timeRange.start < 0 || args.timeRange.end <= args.timeRange.start)) {
    return failure('timeRange requires finite seconds with 0 <= start < end.');
  }
  const timeline = useTimelineStore.getState();
  const media = useMediaStore.getState();
  const sources = new Map(media.files.map(file => [file.id, { name: file.name, duration: file.duration }]));
  for (const composition of media.compositions) sources.set(`comp:${composition.id}`, { name: composition.name, duration: composition.duration });
  return { success: true, data: projectCompositionGraphView({ clips: timeline.clips, tracks: timeline.tracks,
    tempoMap: timeline.tempoMap, duration: timeline.duration, compositionGraph: timeline.compositionGraph,
    compositionId: media.activeCompositionId, media: sources }, args as CompositionGraphViewOptions) };
}

export async function handleStartClipBeatAnalysis(args: Record<string, unknown>): Promise<ToolResult> {
  if (!onlyKeys(args, ['clipId', 'force']) || !validId(args.clipId)
    || (args.force !== undefined && typeof args.force !== 'boolean')) {
    return { success: false, error: 'Expected clipId and optional boolean force.' };
  }
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(candidate => candidate.id === args.clipId);
  if (!clip) return { success: false, error: `Clip not found: ${args.clipId}` };
  const linked = clip.source?.type === 'video'
    ? timeline.clips.find(candidate => candidate.id === clip.linkedClipId && candidate.source?.type === 'audio')
      ?? timeline.clips.find(candidate => candidate.linkedClipId === clip.id && candidate.source?.type === 'audio') : undefined;
  const analyzed = clip.source?.type === 'audio' ? clip : linked;
  if (!analyzed) return { success: false, error: 'Beat analysis requires an audio clip or a video clip with linked audio.' };
  const alreadyAvailable = {
    source: analyzed.audioState?.sourceAnalysisRefs?.beatGridId,
    processed: analyzed.audioState?.processedAnalysisRefs?.beatGridId,
  };
  void useTimelineStore.getState().generateBeatOnsetForClip(analyzed.id, { force: args.force as boolean | undefined }).catch(() => {
    // Like the other analysis starters, the store owns progress and runtime failure handling.
  });
  return { success: true, data: { started: true, clipId: clip.id, analyzedClipId: analyzed.id, alreadyAvailable,
    ...(linked ? { message: 'Beat/onset analysis requested for the linked audio clip.' } : {}),
  } };
}

export async function handleCreateBeatRule(args: Record<string, unknown>): Promise<ToolResult> {
  if (!onlyKeys(args, ['clipIds', 'source', 'params', 'label']) || !validIds(args.clipIds)
    || (args.params !== undefined && !validParams(args.params))
    || (args.label !== undefined && (typeof args.label !== 'string' || !args.label.trim() || args.label.length > 200))) {
    return failure('Expected 1-1000 distinct ordered clipIds, valid params and an optional label of 1-200 characters.');
  }
  const source = parseSource(args.source);
  if (!source) return failure('Invalid source or no existing beat artifact for that clip and provenance.', undefined, 'missing-source');
  return mutate(() => createBeatRule({ clipIds: args.clipIds as string[], source,
    params: args.params as Partial<BeatDistributeRuleParams> | undefined, label: args.label as string | undefined }));
}

export async function handleUpdateBeatRule(args: Record<string, unknown>): Promise<ToolResult> {
  const changes = ['params', 'memberOrder', 'source', 'refreshSource', 'resetCorrection'];
  if (!onlyKeys(args, ['ruleId', ...changes]) || !validId(args.ruleId)
    || changes.filter(key => Object.hasOwn(args, key)).length !== 1) return failure('Provide ruleId and exactly one rule change.');
  const ruleId = args.ruleId;
  const bound = ruleBound(ruleId);
  if (bound) return bound;
  if (Object.hasOwn(args, 'params')) return validParams(args.params)
    ? mutate(() => updateBeatRuleParams(ruleId, args.params as Partial<BeatDistributeRuleParams>)) : failure('Invalid params patch.', ruleId);
  if (Object.hasOwn(args, 'memberOrder')) return validIds(args.memberOrder)
    ? mutate(() => reorderBeatRuleMembers(ruleId, args.memberOrder as string[])) : failure('Expected distinct ordered member IDs.', ruleId);
  if (Object.hasOwn(args, 'source')) {
    const source = parseSource(args.source);
    return source ? mutate(() => setBeatRuleSource(ruleId, source)) : failure('Invalid source or missing beat artifact.', ruleId, 'missing-source');
  }
  if (Object.hasOwn(args, 'refreshSource')) return args.refreshSource === true
    ? mutate(() => refreshBeatRuleSource(ruleId)) : failure('refreshSource must be true.', ruleId);
  return validId(args.resetCorrection) ? mutate(() => resetBeatRuleMemberCorrection(ruleId, args.resetCorrection as string))
    : failure('resetCorrection must be a stable member ID.', ruleId);
}

export async function handleReleaseBeatRuleMember(args: Record<string, unknown>): Promise<ToolResult> {
  if (!onlyKeys(args, ['ruleId', 'memberId']) || !validId(args.ruleId) || !validId(args.memberId)) return failure('ruleId and memberId are required.');
  return ruleBound(args.ruleId) ?? mutate(() => releaseBeatRuleMember(args.ruleId as string, args.memberId as string));
}

export async function handleMaterializeBeatRule(args: Record<string, unknown>): Promise<ToolResult> {
  if (!onlyKeys(args, ['ruleId']) || !validId(args.ruleId)) return failure('ruleId is required.');
  return ruleBound(args.ruleId) ?? mutate(() => materializeBeatRule(args.ruleId as string));
}

export const compositionRuleHandlers = {
  startClipBeatAnalysis: handleStartClipBeatAnalysis,
  getCompositionGraph: handleGetCompositionGraph, createBeatRule: handleCreateBeatRule,
  updateBeatRule: handleUpdateBeatRule, releaseBeatRuleMember: handleReleaseBeatRuleMember,
  materializeBeatRule: handleMaterializeBeatRule,
};
