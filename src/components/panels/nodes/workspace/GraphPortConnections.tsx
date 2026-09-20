import { checkGraphConnection, type ConnectionGraph } from '../../../../services/nodeGraph/graphConnections';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import type { NodeGraphConnectionRequest } from '../../../../types/nodeGraph';
import { ResolveInspectorSection, ResolveInspectorRow, ResolveInspectorIconButton } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';

/** Shared keyboard-accessible counterpart to dragging cables on the canvas. */
export function GraphPortConnections({ graph, nodeId, labelForNode, onConnect, onDisconnect, onSelectNode }: {
  graph: ConnectionGraph; nodeId: string; labelForNode: (id: string) => string;
  onConnect: (connection: NodeGraphConnectionRequest) => void;
  onDisconnect: (id: string) => void; onSelectNode?: (id: string) => void;
}) {
  const node = graph.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return null;
  return <div className="node-graph-port-connections" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button')?.blur();
  }}><ResolveInspectorSection title="Connections">
    {node.inputs.map(port => {
      const incoming = graph.edges.filter(edge => edge.toNodeId === nodeId && edge.toPortId === port.id);
      const candidates = graph.nodes.flatMap(source => source.outputs.flatMap(output => {
        const connection = { fromNodeId: source.id, fromPortId: output.id, toNodeId: nodeId, toPortId: port.id };
        return checkGraphConnection(graph, connection).ok ? [{ connection, label: `${labelForNode(source.id)} · ${output.label}` }] : [];
      }));
      const info = describeNodePort(port);
      return <div key={port.id}>
        <ResolveInspectorRow label={port.label} title={`${info.typeLabel}: ${info.description}`}>
          <InspectorSelect ariaLabel={`${port.label} source`} value="" disabled={port.metadata?.readOnly}
            options={[{ value: '', label: incoming.length ? port.metadata?.repeated ? 'Add source…' : 'Replace source…' : port.metadata?.required ? 'Connect required input…' : 'Disconnected' },
              ...candidates.map((candidate, index) => ({ value: String(index), label: candidate.label }))]}
            onChange={value => { const candidate = candidates[Number(value)]; if (value !== '' && candidate) onConnect(candidate.connection); }} />
        </ResolveInspectorRow>
        {incoming.map(edge => <ResolveInspectorRow key={edge.id} label="" actions={<ResolveInspectorIconButton
          ariaLabel={`Disconnect ${port.label} from ${labelForNode(edge.fromNodeId)}`} disabled={edge.readOnly || port.metadata?.readOnly}
          onClick={() => onDisconnect(edge.id)}>×</ResolveInspectorIconButton>}>
          {onSelectNode ? <button type="button" className="node-workspace-breadcrumb-link" onClick={event => {
            if (event.detail > 0) event.currentTarget.blur(); onSelectNode(edge.fromNodeId);
          }}>{labelForNode(edge.fromNodeId)} · {edge.fromPortId}</button> : <span>{labelForNode(edge.fromNodeId)} · {edge.fromPortId}</span>}
        </ResolveInspectorRow>)}
      </div>;
    })}
    {!node.inputs.length && <p className="face-cable-hint">No inputs</p>}
    {node.outputs.map(port => <ResolveInspectorRow key={port.id} label={port.label} title={describeNodePort(port).description}>
      <span>{graph.edges.filter(edge => edge.fromNodeId === nodeId && edge.fromPortId === port.id).length} connections</span>
    </ResolveInspectorRow>)}
  </ResolveInspectorSection></div>;
}
