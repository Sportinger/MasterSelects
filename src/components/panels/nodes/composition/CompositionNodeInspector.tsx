import { useState } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import type { BeatDistributeRule } from '../../../../types/compositionGraph';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { ResolveInspectorSection, ResolveInspectorRow, ResolveInspectorIconButton } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { BeatRuleInspector, CreateBeatRuleControl } from './rules/BeatRuleInspector';
import { applyCompositionTimeEdit, changeCompositionClipSpeed, moveCompositionClip } from './compositionTimelineEdits';
import { goToCompositionParentClip } from './compositionParentNavigation';

export function CompositionNodeInspector({ node, clipIds, onOpen }: {
  node: NodeGraphNode | null; clipIds: readonly string[]; onOpen: (node: NodeGraphNode) => void;
}) {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const binding = node?.binding;
  const clip = binding?.kind === 'composition-clip' || binding?.kind === 'composition-time-chain'
    ? clips.find(candidate => candidate.id === binding.clipId) : undefined;
  const track = binding?.kind === 'composition-track' ? tracks.find(candidate => candidate.id === binding.trackId) : undefined;
  const transition = binding?.kind === 'composition-transition'
    ? clips.find(candidate => candidate.id === binding.outgoingClipId)?.transitionOut : undefined;
  return <aside className="node-workspace-inspector node-composition-inspector" aria-label="Composition node inspector"
    onClickCapture={event => {
      const button = (event.target as Element).closest('button');
      if (event.detail > 0 && button) button.blur();
    }}>
    <div className="node-workspace-inspector-header"><span>Composition</span><h3>{node?.label ?? 'Select a node'}</h3></div>
    {clip && node && typeof node.params?.parentClipId === 'string' && typeof node.params.parentCompositionId === 'string'
      && <CompositionClipParent key={`${node.params.parentCompositionId}:${node.params.parentClipId}`} clip={clip}
        parentClipId={node.params.parentClipId} parentCompositionId={node.params.parentCompositionId} />}
    {binding?.kind === 'composition-clip' && binding.nestedCompositionId && <ResolveInspectorSection title="Nested composition">
      <ResolveInspectorRow label="Navigate"><button type="button" className="node-workspace-toolbar-button" onClick={event => {
        if (event.detail > 0) event.currentTarget.blur();
        void useMediaStore.getState().openCompositionTab(binding.nestedCompositionId!);
      }}>Open composition</button></ResolveInspectorRow>
    </ResolveInspectorSection>}
    {clip && <CompositionClipTiming key={clip.id} clip={clip} />}
    {track && <ResolveInspectorSection title="Track">
      <ResolveInspectorRow label="Type">{track.type}</ResolveInspectorRow>
      <ResolveInspectorRow label="Locked">{track.locked ? 'Yes' : 'No'}</ResolveInspectorRow>
      <ResolveInspectorRow label="Muted">{track.muted ? 'Yes' : 'No'}</ResolveInspectorRow>
      <ResolveInspectorRow label="Solo">{track.solo ? 'Yes' : 'No'}</ResolveInspectorRow>
      <ResolveInspectorRow label="Visible">{track.visible === false ? 'No' : 'Yes'}</ResolveInspectorRow>
    </ResolveInspectorSection>}
    {transition && node && <ResolveInspectorSection title="Transition">
      <ResolveInspectorRow label="Type">{transition.type}</ResolveInspectorRow>
      <ResolveInspectorRow label="Duration">{transition.duration.toFixed(3)} s</ResolveInspectorRow>
      <ResolveInspectorRow label="Offset">{(transition.offset ?? 0).toFixed(3)} s</ResolveInspectorRow>
      <ResolveInspectorRow label="Body"><button type="button" className="node-workspace-toolbar-button" onClick={() => onOpen(node)}>Open body</button></ResolveInspectorRow>
    </ResolveInspectorSection>}
    {(binding?.kind === 'composition-rule' || binding?.kind === 'composition-beat-source') && <BeatRuleInspector ruleId={binding.ruleId} />}
    {clipIds.length > 1 && <CreateBeatRuleControl clipIds={clipIds} />}
    {!clip && !track && !transition && node?.description && <p className="node-composition-hint">{node.description}</p>}
  </aside>;
}

function CompositionClipParent({ clip, parentClipId, parentCompositionId }: {
  clip: TimelineClip; parentClipId: string; parentCompositionId: string;
}) {
  const composition = useMediaStore(state => state.compositions.find(comp => comp.id === parentCompositionId));
  const mediaName = useMediaStore(state => clip.isComposition
    ? state.compositions.find(comp => comp.id === clip.compositionId)?.name
    : state.files.find(file => file.id === (clip.mediaFileId || clip.source?.mediaFileId))?.name);
  // The inactive composition's durable timeline is sufficient; never load it to display a name.
  const parent = composition?.timelineData?.clips.find(candidate => candidate.id === parentClipId);
  const [warning, setWarning] = useState('');
  const [pending, setPending] = useState(false);
  const navigate = async () => {
    setWarning(''); setPending(true);
    try { await goToCompositionParentClip(parentCompositionId, parentClipId); }
    catch (error) { setWarning(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  };
  return <ResolveInspectorSection title="Parent">
    <ResolveInspectorRow label="Clip">{parent?.name ?? 'Missing parent clip'}</ResolveInspectorRow>
    <ResolveInspectorRow label="Composition">{composition?.name ?? 'Missing composition'}</ResolveInspectorRow>
    <ResolveInspectorRow label="Shared media">{mediaName ?? 'Media unavailable'}</ResolveInspectorRow>
    <ResolveInspectorRow label="Navigate">
      <button type="button" className="node-workspace-toolbar-button node-composition-navigation-link"
        disabled={pending || !composition || !parent} onClick={event => {
          if (event.detail > 0) event.currentTarget.blur();
          void navigate();
        }}>Go to parent clip</button>
    </ResolveInspectorRow>
    {warning && <p className="node-composition-hint" role="status">{warning}</p>}
  </ResolveInspectorSection>;
}

/** Slice, Speed and Place of a clip lane; shared by the composition and the lane's Slice node. */
export function CompositionClipTiming({ clip }: { clip: TimelineClip }) {
  const tracks = useTimelineStore(state => state.tracks);
  const exporting = useTimelineStore(state => state.isExporting);
  const rules = useTimelineStore(state => state.compositionGraph?.rules);
  const mediaDuration = useMediaStore(state => state.files.find(file => file.id === (clip.source?.mediaFileId ?? clip.mediaFileId))?.duration
    ?? state.compositions.find(comp => comp.id === clip.compositionId)?.duration);
  const [warning, setWarning] = useState('');
  const track = tracks.find(candidate => candidate.id === clip.trackId);
  const mapped = !!clip.transitionSourceMap;
  const frozen = clip.timeRemap?.kind === 'freeze';
  const looped = clip.timeRemap?.kind === 'loop';
  const warped = clip.timeRemap?.kind === 'warp';
  const disabled = exporting || !!track?.locked || mapped;
  const rule = Object.values(rules ?? {}).find(candidate => candidate.operator === 'beat-distribute' && candidate.schemaVersion === 1
    && Array.isArray(candidate.members) && candidate.members.some(member => member.clipId === clip.id)) as BeatDistributeRule | undefined;
  const correction = rule?.members.find(member => member.clipId === clip.id)?.correction;
  const sourceEnd = Math.max(clip.outPoint, mediaDuration ?? clip.source?.naturalDuration ?? clip.outPoint);
  const run = (edit: () => string) => {
    try { setWarning(edit()); } catch (error) { setWarning(error instanceof Error ? error.message : String(error)); }
  };
  // Re-read the clip for every event: linked edits and history may replace it during a gesture.
  const trim = (side: 'inPoint' | 'outPoint', value: number) => run(() => {
    const current = useTimelineStore.getState().clips.find(candidate => candidate.id === clip.id);
    if (!current) return 'Clip is no longer available.';
    return applyCompositionTimeEdit({ id: crypto.randomUUID(), type: 'trim-clip', clipId: clip.id,
      inPoint: side === 'inPoint' ? value : current.inPoint, outPoint: side === 'outPoint' ? value : current.outPoint,
      includeLinked: true });
  });
  return <>
    {mapped && <p className="node-composition-hint">Mapped transition timing is read-only. Edit the parent clip or transition duration/offset.</p>}
    {(exporting || track?.locked) && <p className="node-composition-hint" role="status">{exporting ? 'The timeline is locked during export.' : 'This track is locked.'}</p>}
    <ResolveInspectorSection title="Slice">
      <ResolveInspectorNumberRow label="In" suffix="s" value={clip.inPoint} defaultValue={0} min={0} max={Math.max(0, clip.outPoint - 0.04)}
        hardMin={0} hardMax={Math.max(0, clip.outPoint - 0.04)} step={0.01} disabled={disabled} onChange={value => trim('inPoint', value)} />
      <ResolveInspectorNumberRow label="Out" suffix="s" value={clip.outPoint} defaultValue={sourceEnd} min={clip.inPoint + 0.04} max={sourceEnd}
        hardMin={clip.inPoint + 0.04} hardMax={sourceEnd} step={0.01} disabled={disabled} onChange={value => trim('outPoint', value)} />
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Speed">
      <ResolveInspectorRow label="Freeze" disabled={disabled} title="Hold one source frame. Frozen audio is silent.">
        <ResolveInspectorIconButton ariaLabel={frozen ? 'Unfreeze clip' : 'Freeze frame at playhead'} active={frozen} disabled={disabled}
          onClick={() => run(() => {
            const state = useTimelineStore.getState();
            const done = frozen ? state.setClipTimeRemap(clip.id, null) : state.freezeClipAtPlayhead(clip.id);
            return done ? '' : 'Freeze is unavailable for this clip at the playhead (locked, exporting or outside the clip).';
          })}>❚❚</ResolveInspectorIconButton>
      </ResolveInspectorRow>
      <ResolveInspectorRow label="Loop" disabled={disabled || frozen} title="Repeat the trimmed source window; the clip can be extended beyond it.">
        <ResolveInspectorIconButton ariaLabel={looped ? 'Stop looping clip' : 'Loop clip'} active={looped} disabled={disabled || frozen}
          onClick={() => run(() => useTimelineStore.getState().setClipTimeRemap(clip.id, looped ? null : { kind: 'loop' })
            ? '' : 'Loop is unavailable for this clip (locked or exporting).')}>↻</ResolveInspectorIconButton>
      </ResolveInspectorRow>
      <ResolveInspectorRow label="Warp" disabled={disabled} title="Piecewise time remap; edit its points in Properties › Speed Change.">
        <ResolveInspectorIconButton ariaLabel={warped ? 'Remove warp' : 'Warp clip'} active={warped} disabled={disabled}
          onClick={() => run(() => useTimelineStore.getState().toggleClipWarp(clip.id)
            ? '' : 'Warp is unavailable for this clip (locked, exporting or too complex to convert).')}>⤳</ResolveInspectorIconButton>
      </ResolveInspectorRow>
      {warped && clip.timeRemap?.kind === 'warp' && <p className="node-composition-hint">Warp: {clip.timeRemap.points.length} points. Edit them in Properties › Speed Change.</p>}
      {clip.timeRemap?.kind === 'freeze' && <ResolveInspectorNumberRow label="Frozen source" suffix="s" value={clip.timeRemap.sourceTime}
        defaultValue={clip.inPoint} min={0} max={sourceEnd} hardMin={0} hardMax={sourceEnd} step={0.001} disabled={disabled}
        onChange={sourceTime => run(() => useTimelineStore.getState().setClipTimeRemap(clip.id, { kind: 'freeze', sourceTime })
          ? '' : 'The frozen source time could not be changed.')} />}
      {(frozen || warped) && <p className="node-composition-hint">Speed and reverse are kept but have no effect while the clip is {frozen ? 'frozen' : 'warped'}.</p>}
      <ResolveInspectorNumberRow label="Speed" suffix="×" value={clip.speed ?? 1} defaultValue={1} min={-10} max={10} hardMin={-10} hardMax={10}
        step={0.1} disabled={disabled || frozen || warped} onChange={value => run(() => changeCompositionClipSpeed(clip.id, value))} />
      <ResolveInspectorRow label="Reverse" disabled={disabled || frozen || warped}>
        <ResolveInspectorIconButton ariaLabel="Reverse clip" active={clip.reversed === true} disabled={disabled || frozen || warped}
          onClick={() => run(() => changeCompositionClipSpeed(clip.id))}>↶</ResolveInspectorIconButton>
      </ResolveInspectorRow>
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Place">
      {rule && <p className="node-composition-hint">Rule: {rule.label}{correction && (correction.startOffset !== undefined || correction.trackId) ? ' · Correction' : ''}</p>}
      <ResolveInspectorNumberRow label="Start" suffix="s" value={clip.startTime} defaultValue={0} min={0} max={Math.max(60, clip.startTime + clip.duration)}
        numberMax={Infinity} hardMin={0} step={0.01} disabled={disabled} onChange={value => run(() => moveCompositionClip(clip.id, value))} />
      <ResolveInspectorRow label="Track" disabled={disabled}>
        <InspectorSelect ariaLabel="Clip track" value={clip.trackId} disabled={disabled}
          options={tracks.filter(candidate => candidate.type === track?.type).map(candidate => ({ value: candidate.id, label: candidate.name }))}
          onChange={trackId => run(() => {
            const current = useTimelineStore.getState().clips.find(candidate => candidate.id === clip.id);
            return current ? moveCompositionClip(clip.id, current.startTime, trackId) : 'Clip is no longer available.';
          })} />
      </ResolveInspectorRow>
    </ResolveInspectorSection>
    {warning && <p className="node-composition-hint" role="status">{warning}</p>}
  </>;
}
