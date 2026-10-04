import { useState } from 'react';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { createParameterSourceEvaluator } from '../../../../services/parameterSources/parameterSourceEvaluation';
import { parameterSourceTargets } from '../../../../services/parameterSources/parameterSourceTargets';
import { getControlOperator } from '../../../../services/parameterSources/controlOperators';
import { connectControlNodes, disconnectControlEdge, setControlNodeValue, setParameterSourceBinding } from '../../../../services/parameterSources/parameterSourceActions';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import { rigQuickConnect } from '../../../../services/rig/rigQuickConnect';
import { STICK_FIGURE_EFFECT, stickFigureRef } from '../../../../services/rig/stickFigureJointRuntime';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import '../../properties/ParameterSourceControls.css';

const endpointValue = (nodeId: string, portId: string) => `${nodeId}|${portId}`;
const formatOutput = (value: number) => String(Math.round(value * 10000) / 10000);

export function ControlNodeInspector({ clip, nodeId }: { clip: TimelineClip; nodeId: string }) {
  const audioClips = useTimelineStore(state => state.clips);
  const markers = useTimelineStore(state => state.markers);
  const time = useTimelineStore(state => Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)));
  const keys = useTimelineStore(state => state.clipKeyframes.get(clip.id));
  const locked = useTimelineStore(state => state.isExporting || state.tracks.some(track => track.id === clip.trackId && track.locked));
  const [message, setMessage] = useState('');
  const [chosenOutput, setChosenOutput] = useState('');
  const graph = clip.nodeGraph?.parameterSources?.graph, node = graph?.nodes.find(item => item.id === nodeId);
  if (!graph || !node) return null;
  const definition = getControlOperator(node.operator);
  if (!definition) return <p role="alert">Unsupported control operator: {node.operator}</p>;
  const targets = parameterSourceTargets(clip);
  const multiOutput = definition.outputs.length > 1;
  const outputPort = definition.outputs.find(port => port.id === chosenOutput) ?? definition.outputs[0];
  const outputs: Array<{ id: string; label: string; text: string }> = [];
  let outputError = '';
  try {
    const evaluator = createParameterSourceEvaluator(clip, keys ?? [], time);
    for (const port of definition.outputs) outputs.push({ id: port.id, label: multiOutput ? port.label : 'Output',
      text: formatOutput(evaluator.evaluateNode({ nodeId, portId: port.id })) });
  } catch (error) { outputError = error instanceof Error ? error.message : String(error); }
  const safely = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const inputIds = new Set(definition.inputs.map(input => input.id));
  const markerLabels = [...new Set(markers.map(marker => marker.label).filter(Boolean))].toSorted();
  // Limb IK reads a figure on its own clip; Attach to Joint follows a figure on any clip.
  const figureOptions = node.operator === 'rig.limb-ik'
    ? [{ value: '', label: 'First stick figure on this clip' }, ...clip.effects.filter(effect => effect.type === STICK_FIGURE_EFFECT)
      .map(effect => ({ value: effect.id, label: effect.name }))]
    : [{ value: '', label: 'Choose stick figure' }, ...audioClips.flatMap(item => item.effects.filter(effect => effect.type === STICK_FIGURE_EFFECT)
      .map(effect => ({ value: stickFigureRef(item.id, effect.id), label: item.id === clip.id ? `${item.name} (this clip)` : item.name })))];
  const quickConnect = rigQuickConnect(node, clip);
  const sourceOptions = graph.nodes.filter(candidate => candidate.id !== nodeId).flatMap(candidate => {
    const candidateDefinition = getControlOperator(candidate.operator);
    const name = `${candidateDefinition?.label ?? candidate.operator} · ${candidate.id.slice(-6)}`;
    const ports = candidateDefinition?.outputs ?? [{ id: 'value', label: 'Value' }];
    return ports.map(port => ({ value: endpointValue(candidate.id, port.id), label: ports.length > 1 ? `${name} / ${port.label}` : name }));
  });
  return <div className="parameter-source-inspector" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLButtonElement>('button')?.blur();
  }}>
    <ResolveInspectorSection title={definition.label} indicator="none">
      {outputError
        ? <ResolveInspectorRow label="Output"><output>Unavailable</output></ResolveInspectorRow>
        : outputs.map(output => <ResolveInspectorRow key={output.id} label={output.label}><output>{output.text}</output></ResolveInspectorRow>)}
      {definition.parameters.filter(param => !inputIds.has(param.id)).map(param => {
        if (param.type === 'select') {
          const options = param.id === 'audioClipId'
            ? [{ value: '', label: 'Choose analyzed audio source' }, ...audioClips.filter(item => item.source?.type === 'audio' || item.source?.type === 'video').map(item => ({ value: item.id, label: item.name }))]
            : param.id === 'property' ? [{ value: '', label: 'Choose stored curve' }, ...targets.map(target => ({ value: target.path, label: `${target.group} / ${target.label}` }))]
            : node.operator === 'control.marker-trigger' && param.id === 'label'
              ? [{ value: '', label: 'Any marker' }, ...markerLabels.map(label => ({ value: label, label }))]
              : param.id === 'figure' ? figureOptions
              : [...(param.options ?? [])];
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
            value={edge ? endpointValue(edge.from, edge.output) : ''}
            options={[{ value: '', label: raw === 'clip' ? 'Clip time' : raw === 'timeline' ? 'Timeline time' : 'Local value' }, ...sourceOptions]}
            onChange={source => safely(() => {
              if (source) {
                const [sourceNode, sourcePort] = source.split('|');
                connectControlNodes(clip.id, { nodeId: sourceNode, portId: sourcePort }, { nodeId, portId: input.id });
              } else if (edge) disconnectControlEdge(clip.id, edge.id);
            })} /></ResolveInspectorRow>
          {!edge && typeof raw === 'number' && <ResolveInspectorNumberRow label={param?.label ?? input.label} disabled={locked}
            value={raw} defaultValue={Number(param?.default ?? 0)} min={param?.min ?? -10} max={param?.max ?? 10} step={param?.step ?? 0.01}
            onChange={value => safely(() => setControlNodeValue(clip.id, nodeId, input.id, value))} />}
        </ResolveInspectorSection>;
      })}
      {quickConnect && <ResolveInspectorRow label="Quick connect"><button type="button" disabled={locked}
        onClick={() => safely(() => {
          const batch = startBatch(quickConnect.label);
          try {
            for (const { portId, property } of quickConnect.connections) {
              setParameterSourceBinding(clip.id, property, { source: { nodeId, portId }, enabled: true, exposed: true });
            }
          } finally { if (batch.opened) endBatch(); }
        })}>{quickConnect.label}</button></ResolveInspectorRow>}
      {multiOutput && <ResolveInspectorRow label="Connect output"><InspectorSelect ariaLabel="Output to connect" disabled={locked}
        value={outputPort.id} options={definition.outputs.map(port => ({ value: port.id, label: port.label }))}
        onChange={setChosenOutput} /></ResolveInspectorRow>}
      <ResolveInspectorRow label="Connect to"><InspectorSelect ariaLabel="Target parameter" disabled={locked} value=""
        options={[{ value: '', label: 'Choose parameter' }, ...targets.map(target => ({ value: target.path, label: `${target.group} / ${target.label}` }))]}
        onChange={property => { if (property) safely(() => setParameterSourceBinding(clip.id, property, { source: { nodeId, portId: outputPort.id }, enabled: true, exposed: true })); }} /></ResolveInspectorRow>
      {Object.entries(clip.nodeGraph!.parameterSources!.targets).filter(([, binding]) => binding.source?.nodeId === nodeId).map(([path, binding]) => {
        const port = multiOutput ? definition.outputs.find(item => item.id === binding.source?.portId)?.label : undefined;
        const label = targets.find(target => target.path === path)?.label ?? path;
        return <ResolveInspectorRow key={path} label={port ? `${port} → ${label}` : label}>
          <button type="button" disabled={locked} onClick={() => safely(() => setParameterSourceBinding(clip.id, path, { enabled: binding.enabled === false }))}>
            {binding.enabled === false ? 'Enable binding' : 'Disable binding'}
          </button>
        </ResolveInspectorRow>;
      })}
      {(message || outputError) && <p role="alert" className="parameter-source-error">{message || outputError}</p>}
    </ResolveInspectorSection>
  </div>;
}
