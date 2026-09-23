import { useState } from 'react';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { createParameterSourceEvaluator } from '../../../../services/parameterSources/parameterSourceEvaluation';
import { parameterSourceTargets } from '../../../../services/parameterSources/parameterSourceTargets';
import { getControlOperator } from '../../../../services/parameterSources/controlOperators';
import { connectControlNodes, disconnectControlEdge, setControlNodeValue, setParameterSourceBinding } from '../../../../services/parameterSources/parameterSourceActions';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import '../../properties/ParameterSourceControls.css';

export function ControlNodeInspector({ clip, nodeId }: { clip: TimelineClip; nodeId: string }) {
  const audioClips = useTimelineStore(state => state.clips);
  const time = useTimelineStore(state => Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)));
  const keys = useTimelineStore(state => state.clipKeyframes.get(clip.id));
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.id === clip.trackId && track.locked));
  const [message, setMessage] = useState('');
  const graph = clip.nodeGraph?.parameterSources?.graph, node = graph?.nodes.find(item => item.id === nodeId);
  if (!graph || !node) return null;
  const definition = getControlOperator(node.operator);
  if (!definition) return <p role="alert">Unsupported control operator: {node.operator}</p>;
  const targets = parameterSourceTargets(clip);
  let output = '', outputError = '';
  try { output = String(createParameterSourceEvaluator(clip, keys ?? [], time).evaluateNode({ nodeId, portId: 'value' })); }
  catch (error) { outputError = error instanceof Error ? error.message : String(error); }
  const safely = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const inputIds = new Set(definition.inputs.map(input => input.id));
  return <div className="parameter-source-inspector" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    <ResolveInspectorSection title={definition.label} indicator="none">
      <ResolveInspectorRow label="Output"><output>{outputError ? 'Unavailable' : output}</output></ResolveInspectorRow>
      {definition.parameters.filter(param => !inputIds.has(param.id)).map(param => {
        if (param.type === 'select') {
          const options = param.id === 'audioClipId'
            ? [{ value: '', label: 'Choose analyzed audio source' }, ...audioClips.filter(item => item.source?.type === 'audio' || item.source?.type === 'video').map(item => ({ value: item.id, label: item.name }))]
            : param.id === 'property' ? [{ value: '', label: 'Choose stored curve' }, ...targets.map(target => ({ value: target.path, label: `${target.group} / ${target.label}` }))] : [...(param.options ?? [])];
          return <ResolveInspectorRow key={param.id} label={param.label}><InspectorSelect ariaLabel={param.label} disabled={locked}
            value={String(node.constants?.[param.id] ?? param.default)} options={options}
            onChange={value => safely(() => setControlNodeValue(clip.id, nodeId, param.id, value))} /></ResolveInspectorRow>;
        }
        return <ResolveInspectorNumberRow key={param.id} label={param.label} disabled={locked}
          value={Number(node.constants?.[param.id] ?? param.default)} defaultValue={Number(param.default)} min={param.min ?? -10} max={param.max ?? 10} step={param.step ?? 0.01}
          onChange={value => safely(() => setControlNodeValue(clip.id, nodeId, param.id, value))} />;
      })}
      {definition.inputs.map(input => {
        const edge = graph.edges.find(item => item.to === nodeId && item.input === input.id);
        const param = definition.parameters.find(item => item.id === input.id);
        const raw = node.constants?.[input.id] ?? param?.default ?? 0;
        return <ResolveInspectorSection key={input.id} title={param?.label ?? input.label} indicator="none">
          <ResolveInspectorRow label="Input"><InspectorSelect ariaLabel={`${input.label} input source`} disabled={locked}
            value={edge?.from ?? ''} options={[{ value: '', label: input.id === 'time' && raw === 'clip' ? 'Clip time' : input.id === 'time' && raw === 'timeline' ? 'Timeline time' : 'Local value' },
              ...graph.nodes.filter(candidate => candidate.id !== nodeId).map(candidate => ({ value: candidate.id,
                label: `${getControlOperator(candidate.operator)?.label ?? candidate.operator} · ${candidate.id.slice(-6)}` }))]}
            onChange={source => safely(() => {
              if (source) connectControlNodes(clip.id, { nodeId: source, portId: 'value' }, { nodeId, portId: input.id });
              else if (edge) disconnectControlEdge(clip.id, edge.id);
            })} /></ResolveInspectorRow>
          {!edge && typeof raw === 'number' && <ResolveInspectorNumberRow label={param?.label ?? input.label} disabled={locked}
            value={raw} defaultValue={Number(param?.default ?? 0)} min={param?.min ?? -10} max={param?.max ?? 10} step={param?.step ?? 0.01}
            onChange={value => safely(() => setControlNodeValue(clip.id, nodeId, input.id, value))} />}
        </ResolveInspectorSection>;
      })}
      <ResolveInspectorRow label="Connect to"><InspectorSelect ariaLabel="Target parameter" disabled={locked} value=""
        options={[{ value: '', label: 'Choose parameter' }, ...targets.map(target => ({ value: target.path, label: `${target.group} / ${target.label}` }))]}
        onChange={property => { if (property) safely(() => setParameterSourceBinding(clip.id, property, { source: { nodeId, portId: 'value' }, enabled: true, exposed: true })); }} /></ResolveInspectorRow>
      {Object.entries(clip.nodeGraph!.parameterSources!.targets).filter(([, binding]) => binding.source?.nodeId === nodeId).map(([path, binding]) =>
        <ResolveInspectorRow key={path} label={targets.find(target => target.path === path)?.label ?? path}>
          <button type="button" disabled={locked} onClick={() => safely(() => setParameterSourceBinding(clip.id, path, { enabled: binding.enabled === false }))}>
            {binding.enabled === false ? 'Enable binding' : 'Disable binding'}
          </button>
        </ResolveInspectorRow>)}
      {(message || outputError) && <p role="alert" className="parameter-source-error">{message || outputError}</p>}
    </ResolveInspectorSection>
  </div>;
}
