import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useTimelineStore } from '../../../../../stores/timeline';
import type { BeatDistributeRuleParams } from '../../../../../types/compositionGraph';
import {
  createBeatRule, materializeBeatRule, refreshBeatRuleSource, releaseBeatRuleMember,
  reorderBeatRuleMembers, resetBeatRuleMemberCorrection, setBeatRuleSource, updateBeatRuleParams,
  type BeatRuleActionResult,
} from '../../../../../services/compositionRules/beatRuleActions';
import { isBeatDistributeRule } from '../../../../../services/compositionRules/beatRuleOwnership';
import { planBeatDistribution } from '../../../../../services/compositionRules/beatRulePlanning';
import { beatRuleSourceRevision, beatRuleSourceValue, listBeatRuleSourceOptions } from '../../../../../services/compositionRules/beatRuleSource';
import { BeatSourceSelect } from './BeatSourceSelect';
import { InspectorSelect } from '../../../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from '../../../properties/resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorSection, ResolveInspectorRow, ResolveInspectorIconButton } from '../../../properties/resolveInspector/ResolveInspectorPrimitives';
import './BeatRuleInspector.css';

function clearPointerFocus(event: MouseEvent<HTMLDivElement>) {
  if (event.detail === 0 || !(event.target instanceof HTMLElement)) return;
  event.target.closest('button')?.blur();
}

function RuleButton({ children, label, disabled, onClick }: { children: ReactNode; label: string; disabled?: boolean; onClick: () => void }) {
  return <ResolveInspectorIconButton ariaLabel={label} className="beat-rule-action" disabled={disabled} onClick={onClick}>{children}</ResolveInspectorIconButton>;
}

function RuleParams({ params, onChange, disabled }: { params: BeatDistributeRuleParams; onChange: (params: Partial<BeatDistributeRuleParams>) => void; disabled?: boolean }) {
  const tracks = useTimelineStore(state => state.tracks);
  return <>
    <ResolveInspectorNumberRow label="First beat (index)" value={params.firstBeat} defaultValue={0} min={0} max={512} numberMax={1000000} hardMin={0} step={1} disabled={disabled} onChange={firstBeat => onChange({ firstBeat: Math.round(firstBeat) })} />
    <ResolveInspectorNumberRow label="Beat step" value={params.beatStep} defaultValue={1} min={1} max={64} numberMax={1000000} hardMin={1} step={1} disabled={disabled} onChange={beatStep => onChange({ beatStep: Math.round(beatStep) })} />
    <ResolveInspectorNumberRow label="Offset" suffix="s" value={params.offset} defaultValue={0} min={-60} max={60} numberMin={-86400} numberMax={86400} step={0.001} disabled={disabled} onChange={offset => onChange({ offset })} />
    <ResolveInspectorRow label="Target track" disabled={disabled}>
      <InspectorSelect ariaLabel="Beat rule target track" value={params.targetTrackId} disabled={disabled}
        options={tracks.map(track => ({ value: track.id, label: track.name, disabled: track.locked }))} onChange={targetTrackId => onChange({ targetTrackId })} />
    </ResolveInspectorRow>
  </>;
}

function ResultMessages({ result, conflicts = [] }: { result: BeatRuleActionResult | null; conflicts?: { message: string }[] }) {
  const messages = [...new Set([...conflicts.map(conflict => conflict.message), ...(result?.conflicts.map(conflict => conflict.message) ?? []), ...(result?.warnings ?? [])])];
  return messages.length ? <ul className="beat-rule-messages" aria-live="polite">{messages.map(message => <li key={message}>{message}</li>)}</ul> : null;
}

export function BeatRuleInspector({ ruleId }: { ruleId: string }) {
  const stored = useTimelineStore(state => state.compositionGraph?.rules?.[ruleId]);
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const tempoMap = useTimelineStore(state => state.tempoMap);
  const duration = useTimelineStore(state => state.duration);
  const [result, setResult] = useState<BeatRuleActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingSource, setPendingSource] = useState<{ ruleId: string; value: string } | null>(null);
  if (!stored) return null;
  if (!isBeatDistributeRule(stored)) return <ResolveInspectorSection title="Composition rule"><p className="beat-rule-status">This operator or schema version is read-only.</p></ResolveInspectorSection>;
  const rule = stored;
  const locked = rule.status.state === 'locked';
  const stale = rule.status.state === 'stale' || beatRuleSourceRevision(rule.source, { clips, tempoMap, duration }) !== rule.sourceRevision;
  const value = pendingSource?.ruleId === ruleId ? pendingSource.value : beatRuleSourceValue(rule.source);
  const plan = planBeatDistribution(rule, clips, tracks);
  const asyncAction = async (action: () => Promise<BeatRuleActionResult>) => {
    setBusy(true);
    try { setResult(await action()); } finally { setBusy(false); }
  };
  const reorder = (index: number, delta: number) => {
    const ids = rule.members.map(member => member.memberId);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    setResult(reorderBeatRuleMembers(ruleId, ids));
  };
  return <div className="beat-rule-inspector" onClick={clearPointerFocus}>
    <ResolveInspectorSection title={rule.label}>
      <RuleParams params={rule.params} disabled={locked || busy || stale} onChange={params => setResult(updateBeatRuleParams(ruleId, params))} />
      <BeatSourceSelect key={ruleId} ariaLabel="Beat rule source" value={value} disabled={locked || busy} onBusyChange={setBusy}
        onChange={async (next, source) => {
          setPendingSource({ ruleId, value: next });
          if (source) {
            try { await asyncAction(() => setBeatRuleSource(ruleId, source)); }
            finally { setPendingSource(null); }
          }
        }} />
      {(stale || locked) && <p className="beat-rule-status" role="status">{rule.status.state === 'ok' ? 'Beat source changed. Refresh source to recompute.' : rule.status.reason}</p>}
      <div className="beat-rule-actions">
        <RuleButton label="Refresh beat source" disabled={locked || busy} onClick={() => void asyncAction(() => refreshBeatRuleSource(ruleId))}>Refresh source</RuleButton>
        <RuleButton label="Materialize beat rule" disabled={locked || busy} onClick={() => setResult(materializeBeatRule(ruleId))}>Materialize</RuleButton>
      </div>
    </ResolveInspectorSection>
    <ResolveInspectorSection title={`Members (${rule.members.length})`}>
      {rule.members.map((member, index) => <div className="beat-rule-member" key={member.memberId}>
        <div className="beat-rule-member-name">{index + 1}. {clips.find(clip => clip.id === member.clipId)?.name ?? `Missing: ${member.clipId}`}</div>
        <div className="beat-rule-correction">Correction: {(member.correction?.startOffset ?? 0).toFixed(3)} s{member.correction?.trackId ? ` · ${tracks.find(track => track.id === member.correction?.trackId)?.name ?? member.correction.trackId}` : ''}</div>
        <div className="beat-rule-actions">
          <RuleButton label={`Move member ${index + 1} up`} disabled={locked || busy || stale || index === 0} onClick={() => reorder(index, -1)}>↑</RuleButton>
          <RuleButton label={`Move member ${index + 1} down`} disabled={locked || busy || stale || index === rule.members.length - 1} onClick={() => reorder(index, 1)}>↓</RuleButton>
          <RuleButton label={`Reset correction for member ${index + 1}`} disabled={locked || busy || stale} onClick={() => setResult(resetBeatRuleMemberCorrection(ruleId, member.memberId))}>Reset correction</RuleButton>
          <RuleButton label={`Release member ${index + 1}`} disabled={locked || busy} onClick={() => setResult(releaseBeatRuleMember(ruleId, member.memberId))}>Release</RuleButton>
        </div>
      </div>)}
    </ResolveInspectorSection>
    <ResultMessages result={result} conflicts={plan.conflicts} />
  </div>;
}

export function CreateBeatRuleControl({ clipIds: selectedIds }: { clipIds: readonly string[] }) {
  const clips = useTimelineStore(state => state.clips);
  // Planning moves linked partners like move-clips; a selected audio partner of a
  // selected video clip is not its own member (it would target the video track).
  const clipIds = useMemo(() => {
    const byId = new Map(clips.map(clip => [clip.id, clip]));
    const selected = new Set(selectedIds);
    return selectedIds.filter(id => {
      const clip = byId.get(id), linked = clip?.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
      return !(clip?.source?.type === 'audio' && linked && selected.has(linked.id) && linked.source?.type !== 'audio');
    });
  }, [clips, selectedIds]);
  const [sourceKey, setSourceKey] = useState('tempo-map');
  const [draft, setDraft] = useState<Partial<BeatDistributeRuleParams>>({});
  const [result, setResult] = useState<BeatRuleActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const options = listBeatRuleSourceOptions(clips);
  const source = options.find(option => option.value === sourceKey)?.source;
  const params = { firstBeat: 0, beatStep: 1, offset: 0, targetTrackId: clips.find(clip => clip.id === clipIds[0])?.trackId ?? '', ...draft };
  const create = async () => {
    if (!source) return;
    setBusy(true);
    try { setResult(await createBeatRule({ clipIds: [...clipIds], source, params })); } finally { setBusy(false); }
  };
  return <div className="beat-rule-inspector" onClick={clearPointerFocus}>
    <ResolveInspectorSection title="Distribute on beats" defaultOpen={false}>
      <RuleParams params={params} disabled={busy} onChange={patch => setDraft(current => ({ ...current, ...patch }))} />
      <BeatSourceSelect ariaLabel="New beat rule source" value={sourceKey} disabled={busy}
        onBusyChange={setBusy} onChange={setSourceKey} />
      <div className="beat-rule-actions"><RuleButton label="Create beat rule" disabled={busy || !clipIds.length || !source} onClick={() => void create()}>Distribute {clipIds.length} {clipIds.length === 1 ? 'clip' : 'clips'}</RuleButton></div>
      <ResultMessages result={result} />
    </ResolveInspectorSection>
  </div>;
}
