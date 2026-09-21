import { useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useDockStore } from '../../../stores/dockStore';
import { createParameterSourceEvaluator } from '../../../services/parameterSources/parameterSourceEvaluation';
import { getParameterSourceTarget, isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
import { addParameterSource, setParameterBaseValue, setParameterSourceBinding } from '../../../services/parameterSources/parameterSourceActions';
import { getControlOperator } from '../../../services/parameterSources/controlOperators';
import { requestNodeAnimation } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorIconButton, ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { KeyframeToggle } from './shared';
import type { AnimatableProperty } from '../../../types/animationProperties';
import './ParameterSourceControls.css';

export function ParameterSourceNumberRow({ clipId, property, disabled = false }: { clipId: string; property: string; disabled?: boolean }) {
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const keys = useTimelineStore(state => state.clipKeyframes.get(clipId));
  const playhead = useTimelineStore(state => state.playheadPosition);
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.id === clip?.trackId && track.locked));
  const [open, setOpen] = useState(false), [message, setMessage] = useState('');
  const target = clip && getParameterSourceTarget(clip, property);
  if (!clip || !target) return null;
  const binding = clip.nodeGraph?.parameterSources?.targets[property];
  const driven = isParameterNodeDriven(clip, property), readOnly = disabled || locked;
  let value = target.value, error = '', kind = 'Fixed';
  try {
    const result = createParameterSourceEvaluator(clip, keys ?? [], Math.max(0, Math.min(clip.duration, playhead - clip.startTime))).resolve(property);
    value = result.value; kind = result.kind === 'node' ? 'Node' : result.kind === 'keyframes' ? 'Keys' : 'Fixed';
  } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); kind = 'Error'; }
  const safely = (action: () => void) => { try { action(); setMessage(''); } catch (failure) { setMessage(failure instanceof Error ? failure.message : String(failure)); } };
  const nodes = clip.nodeGraph?.parameterSources?.graph.nodes ?? [];
  const selection = driven ? `node:${binding!.source!.nodeId}` : binding?.localMode === 'constant' ? 'fixed' : 'auto';
  const navigate = (id: string) => { requestNodeAnimation(clipId, id, false); useDockStore.getState().activatePanelType('node-workspace'); };
  return <div className="parameter-source-control" onPointerUp={event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button) requestAnimationFrame(() => { if (document.activeElement === button) button.blur(); });
  }}>
    <ResolveInspectorNumberRow label={target.label} ariaLabel={target.label} value={value} defaultValue={target.defaultValue}
      min={target.min} max={target.max} hardMin={target.hardMin} hardMax={target.hardMax} step={target.step}
      disabled={readOnly || driven || !!error} persistenceKey={`parameter.${property}`}
      onReset={next => safely(() => { if (!readOnly && !driven) setParameterBaseValue(clipId, property, next); })}
      onChange={next => safely(() => {
        if (readOnly || driven) return;
        const state = useTimelineStore.getState();
        state.setPropertyValue(clipId, property as AnimatableProperty, next);
      })}
      keyframeToggle={!readOnly && !driven && !error && binding?.localMode !== 'constant'
        ? <KeyframeToggle clipId={clipId} property={property as AnimatableProperty} value={value} /> : undefined} />
    <div className="parameter-source-status">
      <button type="button" aria-expanded={open} title={`Parameter source: ${kind}`} onClick={() => setOpen(previous => !previous)}>{kind} · Source</button>
      {driven && <button type="button" onClick={() => navigate(binding!.source!.nodeId)}>Go to source</button>}
    </div>
    {open && <>
      <ResolveInspectorRow label="Source"><InspectorSelect ariaLabel={`${target.label} source`} disabled={readOnly} value={selection}
        options={[{ value: 'auto', label: 'Local value / keyframes' }, { value: 'fixed', label: 'Fixed (keep keys)' },
          ...nodes.map(node => ({ value: `node:${node.id}`, label: `${getControlOperator(node.operator)?.label ?? node.operator} · ${node.id.slice(-6)}` })),
          ...['control.lfo', 'values.number', 'control.keyframes'].map(operator => ({ value: `add:${operator}`, label: `New ${getControlOperator(operator)!.label}` }))]}
        onChange={next => safely(() => {
          if (next.startsWith('add:')) navigate(addParameterSource(clipId, property, next.slice(4)));
          else if (next.startsWith('node:')) setParameterSourceBinding(clipId, property, { source: { nodeId: next.slice(5), portId: 'value' }, enabled: true, exposed: true });
          else setParameterSourceBinding(clipId, property, { enabled: false, localMode: next === 'fixed' ? 'constant' : 'auto' });
        })} /></ResolveInspectorRow>
      <ResolveInspectorRow label="Graph input" actions={<ResolveInspectorIconButton ariaLabel="Show parameter in Nodes" onClick={() => {
        const ownerId = property.startsWith('effect.') ? `effect-${property.split('.')[1]}` : 'color';
        requestNodeAnimation(clipId, binding?.source?.nodeId ?? ownerId, false); useDockStore.getState().activatePanelType('node-workspace');
      }}>↗</ResolveInspectorIconButton>}>
        <button type="button" disabled={readOnly || !!binding?.source} onClick={() => safely(() => setParameterSourceBinding(clipId, property, { exposed: binding?.exposed === false }))}>
          {binding?.source ? 'Connected port is visible' : binding?.exposed === false ? 'Show port' : 'Hide unused port'}
        </button>
      </ResolveInspectorRow>
      {driven && <p className="effect-info">Driven by a node. Local value and keys are preserved; switch to local to edit them.</p>}
    </>}
    {(error || message) && <p role="alert" className="parameter-source-error">{error || message}</p>}
  </div>;
}
