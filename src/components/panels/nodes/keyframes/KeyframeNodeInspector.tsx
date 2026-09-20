import { useMemo, useState } from 'react';
import type { AnimatableProperty, Keyframe, TimelineClip } from '../../../../types';
import type { KeyframeNodeDefinition } from '../../../../types/keyframeNode';
import { useTimelineStore } from '../../../../stores/timeline';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import { changeKeyframeNode, connectKeyframeNode, disconnectKeyframeNode, removeKeyframeNode } from '../../../../services/nodeGraph/keyframeNodeActions';
import { keyframeNodeParameters, type KeyframeNodeParameter } from '../../../../services/nodeGraph/keyframeNodeParameters';
import { clipLocalToKeyframeTime, getKeyframeTimeBasis, keyframeTimeToClipLocal } from '../../../../services/flock/time/flockKeyframeTime';
import { interpolateKeyframes } from '../../../../utils/keyframeInterpolation';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveInspectorSection } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { KeyframeCurve } from './KeyframeNodeCurve';

const EMPTY: Keyframe[] = [];
const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier', 'hold'].map(value => ({ value, label: value }));

export function KeyframeNodeInspector({ clip, nodeId }: { clip: TimelineClip; nodeId: string }) {
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('');
  const keys = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY);
  const locked = useTimelineStore(s => s.isExporting || Boolean(s.tracks.find(t => t.id === clip.trackId)?.locked));
  const parameters = useMemo(() => keyframeNodeParameters(clip), [clip]);
  const node = clip.nodeGraph?.keyframeNodes?.find(n => n.id === nodeId);
  if (!node) return null;
  const safely = (label: string, action: () => void) => {
    const batch = startBatch(label);
    try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (batch.opened) endBatch(); }
  };
  const occupied = new Set(clip.nodeGraph?.keyframeNodes?.flatMap(n => n.channels.flatMap(c => [c.property, ...c.targets.map(t => t.property)])));
  const available = parameters.filter(p => !occupied.has(p.property) && `${p.group} ${p.label} ${p.property}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="keyframe-node-inspector" onClick={event => {
    if (event.detail > 0 && event.target instanceof Element && !event.target.closest('.inspector-select')) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    <ResolveInspectorSection title="Keyframe Node" indicator="none">
      <ResolveInspectorRow label="Name"><input className="keyframe-node-name" aria-label="Keyframe node name" defaultValue={node.label} key={node.id + node.label}
        disabled={locked} onBlur={event => { if (event.target.value.trim() && event.target.value !== node.label) safely('Rename keyframe node', () => changeKeyframeNode(clip.id, node.id, { label: event.target.value.trim() })); }} /></ResolveInspectorRow>
      <p className="keyframe-node-hint">These are the same keyframes as in the timeline. Linked parameters share a curve; edits in either view update every target.</p>
      <ResolveInspectorRow label="Find parameter"><input className="keyframe-node-name" aria-label="Find animation parameter" value={filter} onChange={e => setFilter(e.target.value)} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Add channel"><InspectorSelect ariaLabel="Add animation channel" value="" disabled={locked}
        options={[{ value: '', label: 'Choose parameter…' }, ...available.map(p => ({ value: p.property, label: `${p.group} / ${p.label}` }))]}
        onChange={property => { if (property) safely('Add animation channel', () => connectKeyframeNode(clip.id, node.id, property as AnimatableProperty)); }} /></ResolveInspectorRow>
    </ResolveInspectorSection>
    {node.channels.map(channel => <ChannelEditor key={channel.id} clip={clip} node={node} channelId={channel.id} keys={keys}
      parameters={parameters} available={available} locked={locked} safely={safely} />)}
    {message && <p className="keyframe-node-hint" role="alert">{message}</p>}
    <button type="button" className="node-workspace-secondary-action" disabled={locked}
      onClick={() => safely('Remove keyframe node', () => removeKeyframeNode(clip.id, node.id))}>Remove node · keep animation</button>
  </div>;
}

function ChannelEditor({ clip, node, channelId, keys, parameters, available, locked, safely }: {
  clip: TimelineClip; node: KeyframeNodeDefinition; channelId: string; keys: Keyframe[];
  parameters: KeyframeNodeParameter[]; available: KeyframeNodeParameter[]; locked: boolean;
  safely: (label: string, action: () => void) => void;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [target, setTarget] = useState('');
  const [mapped, setMapped] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState(0);
  const playhead = useTimelineStore(s => s.playheadPosition);
  const channel = node.channels.find(c => c.id === channelId)!;
  const parameter = parameters.find(p => p.property === channel.property);
  const state = useTimelineStore.getState();
  const local = Math.max(0, Math.min(clip.duration, playhead - clip.startTime));
  const time = clipLocalToKeyframeTime(clip, channel.property, local, state.getSourceTimeForClip);
  const curve = keys.filter(k => k.property === channel.property).toSorted((a, b) => a.time - b.time);
  const selected = curve.find(k => k.id === selectedId) ?? curve.find(k => Math.abs(k.time - time) < 0.001) ?? curve[0];
  const value = interpolateKeyframes(keys, channel.property, time, parameter?.value ?? 0);
  const range = { min: parameter?.min ?? Math.min(-1, value * 2), max: parameter?.max ?? Math.max(1, value * 2), step: parameter?.step ?? 0.01 };
  const selectedLocal = selected ? keyframeTimeToClipLocal(clip, selected, state.getSourceTimeForClip) : null;
  const isCable = [channel.property, ...channel.targets.map(t => t.property)].some(p => clip.effects.some(e => e.type === 'face-cables' && p.startsWith(`effect.${e.id}.`)));
  const addKey = (newValue: number) => safely('Set animation keyframe', () => {
    state.addKeyframe(clip.id, channel.property, parameter?.discrete ? Number(newValue >= 0.5) : newValue, local);
    if (parameter?.discrete) {
      const key = useTimelineStore.getState().clipKeyframes.get(clip.id)?.find(k => k.property === channel.property && Math.abs(k.time - time) < 0.001);
      if (key) state.updateKeyframe(key.id, { hold: true });
    }
  });
  const openCurve = () => {
    state.selectClip(clip.id);
    if (!state.isTrackExpanded(clip.trackId)) state.toggleTrackExpanded(clip.trackId);
    if (!state.isCurveExpanded(clip.trackId, channel.property)) state.toggleCurveExpanded(clip.trackId, channel.property);
  };
  return <ResolveInspectorSection title={parameter?.label ?? channel.property} indicator="none" headerActions={
    <ResolveInspectorIconButton ariaLabel={`Disconnect ${parameter?.label ?? channel.property}`} disabled={locked}
      title="Disconnect this channel; keep its animation" onClick={() => safely('Disconnect animation', () => disconnectKeyframeNode(clip.id, node.id, channel.property))}>×</ResolveInspectorIconButton>
  }>
    {!parameter && <p className="keyframe-node-hint" role="status">The source parameter is missing. Disconnect this channel to keep the remaining animation.</p>}
    <KeyframeCurve clip={clip} property={channel.property} value={parameter?.value} />
    <ResolveInspectorNumberRow label="At playhead" ariaLabel={`${parameter?.label} at playhead`} value={value} defaultValue={parameter?.defaultValue ?? 0}
      {...range} hardMin={parameter?.min} hardMax={parameter?.max} disabled={locked || !parameter} onChange={addKey}
      keyframeToggle={<ResolveInspectorIconButton ariaLabel="Add keyframe at playhead" disabled={locked || !parameter} onClick={() => addKey(value)}>◇</ResolveInspectorIconButton>} />
    <p className="keyframe-node-hint">{getKeyframeTimeBasis(channel.property) === 'source' ? 'Source time' : 'Clip time'}: {time.toFixed(3)} s{isCable ? ' · Bake cables after editing for playback and export.' : ''}</p>
    <ResolveInspectorRow label="Keyframe"><InspectorSelect ariaLabel="Select animation keyframe" value={selected?.id ?? ''}
      options={curve.map(k => ({ value: k.id, label: `${k.time.toFixed(3)} s · ${Number(k.value.toFixed(3))}` }))} onChange={setSelectedId} /></ResolveInspectorRow>
    {selected && <>
      <ResolveInspectorNumberRow label="Time" ariaLabel="Keyframe clip time" value={selectedLocal ?? 0} defaultValue={0} min={0} max={clip.duration} hardMin={0} hardMax={clip.duration} step={0.001}
        disabled={locked || selectedLocal === null} onChange={next => safely('Move animation keyframe', () => state.moveKeyframe(selected.id, next))} />
      <ResolveInspectorNumberRow label="Value" ariaLabel="Keyframe value" value={selected.value} defaultValue={parameter?.defaultValue ?? 0} {...range}
        hardMin={parameter?.min} hardMax={parameter?.max} disabled={locked} onChange={next => safely('Edit animation keyframe', () => state.updateKeyframe(selected.id, { value: parameter?.discrete ? Number(next >= 0.5) : next }))} />
      <ResolveInspectorRow label="Transition"><InspectorSelect ariaLabel="Keyframe transition" disabled={locked || parameter?.discrete}
        value={selected.hold ? 'hold' : selected.easing} options={EASINGS}
        onChange={easing => safely('Edit keyframe transition', () => state.updateKeyframe(selected.id, {
          easing: easing === 'hold' ? 'linear' : easing, hold: easing === 'hold',
          ...(easing !== 'bezier' ? { handleIn: undefined, handleOut: undefined } : {}),
        }))} /></ResolveInspectorRow>
      <div className="keyframe-node-link">
        <button type="button" className="node-workspace-secondary-action" onClick={() => { if (selectedLocal !== null) state.setPlayheadPosition(clip.startTime + selectedLocal); }}>Go to keyframe</button>
        <ResolveInspectorIconButton ariaLabel="Delete selected animation keyframe" disabled={locked}
          onClick={() => safely('Delete animation keyframe', () => state.removeKeyframe(selected.id))}>×</ResolveInspectorIconButton>
      </div>
    </>}
    <button type="button" className="node-workspace-secondary-action" onClick={openCurve}>Show timeline keys</button>
    {channel.targets.map(link => <div className="keyframe-node-link" key={link.property}>
      <span>{parameters.find(p => p.property === link.property)?.label ?? link.property}{link.scale !== 1 || link.offset !== 0 ? ` · ×${link.scale} + ${link.offset}` : ''}</span>
      <ResolveInspectorIconButton ariaLabel={`Unlink ${link.property}`} disabled={locked} onClick={() => safely('Unlink animation', () => disconnectKeyframeNode(clip.id, node.id, link.property))}>×</ResolveInspectorIconButton>
    </div>)}
    <ResolveInspectorRow label="Link parameter"><InspectorSelect ariaLabel={`Link parameter to ${parameter?.label}`} value={target} disabled={locked}
      options={[{ value: '', label: 'Choose target…' }, ...available.map(p => ({ value: p.property, label: `${p.group} / ${p.label}` }))]} onChange={setTarget} /></ResolveInspectorRow>
    {target && <>
      <ResolveInspectorRow label="Mapping"><InspectorSelect ariaLabel="Animation value mapping" value={mapped ? 'mapped' : 'same'}
        options={[{ value: 'same', label: 'Same values' }, { value: 'mapped', label: 'Scale + offset' }]} onChange={v => setMapped(v === 'mapped')} /></ResolveInspectorRow>
      {mapped && <>
        <ResolveInspectorNumberRow label="Scale" value={scale} defaultValue={1} min={-10} max={10} step={0.01} onChange={setScale} />
        <ResolveInspectorNumberRow label="Offset" value={offset} defaultValue={0} min={-100} max={100} step={0.01} onChange={setOffset} />
      </>}
      <button type="button" className="node-workspace-secondary-action" disabled={locked} onClick={() => safely('Link animation parameter', () => {
        connectKeyframeNode(clip.id, node.id, target as AnimatableProperty, channel.id, mapped ? { scale, offset } : undefined); setTarget('');
      })}>{keys.some(k => k.property === target) ? 'Link curve · replace target animation' : 'Link curve'}</button>
    </>}
  </ResolveInspectorSection>;
}
