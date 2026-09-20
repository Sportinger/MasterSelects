import { operatorPortsCompatible } from '../../../../services/operators/portContracts';
import { useTimelineStore } from '../../../../stores/timeline';
import { usePreciseFaceTrack } from '../../../../services/landmarkTracking/usePreciseFaceTrack';
import { sourceArtifactPorts, sourceArtifactPortId } from '../../../../services/nodeGraph/sourceArtifactPorts';
import { sourceArtifactKind, sourceArtifactOperator } from '../../../../services/operators/sourceArtifactOperators';
import { connectSourceArtifact } from '../../../../services/operators/sourceArtifactConnections';
import type { EffectOperatorGraph, BoundOperatorNode } from '../../../../types/operatorGraph';
import { getEffectOperator } from '../../../../services/operators/operatorRegistry';
import { createEffectGraphActions } from '../../../../services/operators/effectGraphEditing';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { GraphPortConnections } from './GraphPortConnections';
import { operatorConnectionGraph } from '../../../../services/operators/operatorConnectionGraph';

export function OperatorConnections({ graph, node, clipId, effectId, safely }: {
  graph: EffectOperatorGraph; node: BoundOperatorNode; clipId: string; effectId: string; safely: (fn: () => void) => void;
}) {
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const tracking = usePreciseFaceTrack(clipId);
  const artifacts = clip ? sourceArtifactPorts(clip, tracking.ready).filter(p =>
    p.metadata?.sourceArtifact?.kind !== 'scene-depth' || p.metadata.sourceArtifact.effectId === effectId) : [];
  const inputs = getEffectOperator(node.operator)!.inputs.filter(p => !p.repeated);
  const actions = createEffectGraphActions(clipId, effectId);
  if (graph.domain === 'voxel') return <GraphPortConnections graph={operatorConnectionGraph(graph)} nodeId={node.id}
    labelForNode={id => { const source = graph.nodes.find(value => value.id === id); return `${getEffectOperator(source?.operator ?? '')?.label ?? id} (${id})`; }}
    onConnect={connection => safely(() => actions.connectPorts(connection))} onDisconnect={id => safely(() => actions.disconnectEdge(id))} />;
  if (!inputs.length) return null;
  return <ResolveInspectorSection title="Connections">
    {inputs.map(port => {
      const edge = graph.edges.find(e => e.to === node.id && e.input === port.id);
      const connectedArtifact = sourceArtifactKind(graph.nodes.find(n => n.id === edge?.from)?.operator ?? '');
      const value = connectedArtifact ? `artifact/${sourceArtifactPortId(connectedArtifact, effectId)}` : edge ? `${edge.from}/${edge.output}` : '';
      const sources = graph.nodes.filter(candidate => !sourceArtifactKind(candidate.operator)).flatMap(candidate => getEffectOperator(candidate.operator)!.outputs
        .filter(p => candidate.id !== node.id && operatorPortsCompatible(p, port))
        .map(p => ({ value: `${candidate.id}/${p.id}`, label: `${getEffectOperator(candidate.operator)!.label} · ${candidate.id}` })));
      const sourceArtifacts = artifacts.filter(p => operatorPortsCompatible(getEffectOperator(sourceArtifactOperator(p.metadata!.sourceArtifact!.kind))!.outputs[0], port));
      return <ResolveInspectorRow key={port.id} label={port.label}><InspectorSelect ariaLabel={`${getEffectOperator(node.operator)!.label} ${port.label} input`}
        value={value} options={[...(!port.required ? [{ value: '', label: 'Disconnected' }] : []),
          ...sourceArtifacts.map(p => ({ value: `artifact/${p.id}`, label: `Video Source · ${p.label}${p.metadata?.stale ? ' (stale)' : !p.metadata?.available ? ' (missing)' : ''}`,
            disabled: !p.metadata?.available || p.metadata.stale })), ...sources]}
        onChange={value => safely(() => {
          if (!value) { if (edge) actions.disconnectEdge(edge.id); return; }
          if (value.startsWith('artifact/')) {
            const artifact = sourceArtifacts.find(p => p.id === value.slice(9))?.metadata?.sourceArtifact;
            if (!artifact) throw new Error('Source artifact is unavailable.');
            connectSourceArtifact(clipId, artifact, { effectId, nodeId: node.id, portId: port.id }); return;
          }
          const [fromNodeId, fromPortId] = value.split('/'); actions.connectPorts({ fromNodeId, fromPortId, toNodeId: node.id, toPortId: port.id });
        })} /></ResolveInspectorRow>;
    })}
  </ResolveInspectorSection>;
}
