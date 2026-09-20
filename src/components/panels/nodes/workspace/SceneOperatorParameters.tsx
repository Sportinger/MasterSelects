import { operatorPortsCompatible } from '../../../../services/operators/portContracts';
import { useState } from 'react';
import type { TimelineClip } from '../../../../types/timeline';
import { createSceneGraphActions } from '../../../../services/operators/sceneGraphEditing';
import { sceneGraphForClip } from '../../../../services/operators/sceneGraph';
import { SCENE_OPERATORS, sceneBypassDescription } from '../../../../services/operators/sceneOperators';
import { useTimelineStore } from '../../../../stores/timeline';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorSection, ResolveInspectorRow, ResolveInspectorIconButton } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { TransformTab } from '../../properties/TransformTab';
import { scenePrimitiveShape, type ScenePrimitiveShape } from '../../../../services/operators/scenePrimitive';

export function SceneOperatorParameters({ clip, nodeId, onAdded }: { clip: TimelineClip; nodeId: string; onAdded: (id: string) => void }) {
  const [message, setMessage] = useState('');
  const locked = useTimelineStore(state => state.isExporting || Boolean(state.tracks.find(track => track.id === clip.trackId)?.locked));
  const definition = sceneGraphForClip(clip), node = definition.graph.nodes.find(n => n.id === nodeId);
  const operator = SCENE_OPERATORS.find(o => o.id === node?.operator), actions = createSceneGraphActions(clip.id);
  if (!node || !operator) return null;
  const safely = (fn: () => void) => { try { fn(); setMessage(''); } catch (error) { setMessage(String(error)); } };
  return <div className="operator-parameters" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button,select')?.blur();
  }}>
    <ResolveInspectorSection title={operator.label} enabled={!node.bypassed}
      onEnabledChange={locked ? undefined : () => safely(() => actions.toggleBypass(nodeId))}>
      <p className="face-cable-hint">{operator.description}</p>
      <p className="face-cable-hint">{sceneBypassDescription(operator.id)}</p>
      {operator.id === 'geometry.primitive' && <ResolveInspectorRow label="Shape"><InspectorSelect ariaLabel="Primitive shape" value={scenePrimitiveShape(node)}
        disabled={locked}
        options={[{ value: 'box', label: 'Box' }, { value: 'sphere', label: 'Sphere' }, { value: 'cylinder', label: 'Cylinder' }]}
        onChange={value => safely(() => actions.setPrimitiveShape(nodeId, value as ScenePrimitiveShape))} /></ResolveInspectorRow>}
      {operator.parameters.map(spec => {
        const binding = node.bindings[spec.id], value = typeof binding === 'string' ? definition.params[binding] ?? spec.default : spec.default;
        return <ResolveInspectorNumberRow key={spec.id} label={spec.label} ariaLabel={`${operator.label} ${spec.label}`} value={Number(value)} defaultValue={Number(spec.default)} min={spec.min ?? 0} max={spec.max ?? 1} step={spec.step ?? 0.01}
          onChange={value => safely(() => actions.setParameter(nodeId, spec.id, value))} persistenceKey={`scene.${nodeId}.${spec.id}`} />;
      })}
    </ResolveInspectorSection>
    {operator.inputs.length > 0 && <ResolveInspectorSection title="Connections">
      {operator.inputs.map(port => {
        const edge = definition.graph.edges.find(e => e.to === nodeId && e.input === port.id);
        const sources = definition.graph.nodes.flatMap(candidate => (SCENE_OPERATORS.find(o => o.id === candidate.operator)?.outputs ?? [])
          .filter(p => candidate.id !== nodeId && operatorPortsCompatible(p, port)).map(p => ({ value: `${candidate.id}/${p.id}`, label: `${SCENE_OPERATORS.find(o => o.id === candidate.operator)!.label} · ${candidate.id} · ${p.label}` })));
        return <ResolveInspectorRow key={port.id} label={port.label}><InspectorSelect ariaLabel={`${operator.label} ${port.label} input`} value={edge ? `${edge.from}/${edge.output}` : ''}
          options={[{ value: '', label: 'Disconnected' }, ...sources]} onChange={value => safely(() => {
            if (!value) { if (edge) actions.disconnectEdge(edge.id); return; }
            const [fromNodeId, fromPortId] = value.split('/'); actions.connectPorts({ fromNodeId, fromPortId, toNodeId: nodeId, toPortId: port.id });
          })} /></ResolveInspectorRow>;
      })}
    </ResolveInspectorSection>}
    {operator.id === 'scene.clip-transform' && <TransformTab clipId={clip.id} transform={clip.transform} is3D speed={clip.speed} />}
    <ResolveInspectorSection title="Scene nodes">
      <InspectorSelect ariaLabel="Add scene node" value="" options={[{ value: '', label: 'Add node…' }, ...SCENE_OPERATORS.filter(o => o.addable).map(o => ({ value: o.id, label: o.label }))]}
        onChange={value => { if (value) safely(() => onAdded(actions.addNode(value))); }} />
      {operator.addable && <ResolveInspectorRow label="Node"><ResolveInspectorIconButton title="Delete scene node" ariaLabel="Delete scene node" onClick={() => safely(() => { actions.deleteNode(nodeId); onAdded('render'); })}>×</ResolveInspectorIconButton></ResolveInspectorRow>}
    </ResolveInspectorSection>
    {message && <p role="alert">{message}</p>}
  </div>;
}
