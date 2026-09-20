import { useMemo, useState } from 'react';
import type { TimelineClip } from '../../../types/timeline';
import type { ColorNodeType } from '../../../types/colorCorrection';
import { useTimelineStore } from '../../../stores/timeline';
import { readTimelineRuntimeState } from '../../../services/timeline/timelineRuntimeCoordinator';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { buildClipColorNodeGraph } from '../../../services/nodeGraph/clipGraphDocument';
import { createColorNodeActions } from '../../../services/nodeGraph/colorNodeActions';
import { NodeGraphCanvas } from '../nodes/NodeGraphCanvas';
import { reconnectNodePorts } from '../nodes/canvas/reconnectNodePorts';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import '../nodes/NodeWorkspacePanel.css';

const NODE_TYPES: { value: ColorNodeType; label: string }[] = [
  { value: 'primary', label: 'Corrector' }, { value: 'wheels', label: 'Wheels' },
  { value: 'parallel-mixer', label: 'Parallel Mixer' }, { value: 'layer-mixer', label: 'Layer Mixer' },
  { value: 'key-mixer', label: 'Key Mixer' }, { value: 'splitter', label: 'Splitter' },
  { value: 'combiner', label: 'Combiner' }, { value: 'source', label: 'Source' },
  { value: 'alpha-output', label: 'Alpha Output' },
];

/** Focused Color view: the same worker canvas and owner mutations as Nodes. */
export function ColorNodeCanvas({ clip, selectedNodeId, onSelectNode, addNodeDisabled }: {
  clip: TimelineClip; selectedNodeId?: string; onSelectNode: (id: string) => void; addNodeDisabled: boolean;
}) {
  const graph = useMemo(() => buildClipColorNodeGraph(clip), [clip]);
  const actions = useMemo(() => createColorNodeActions(clip.id), [clip.id]);
  const [selection, setSelection] = useState<{ graphId: string; ids: string[] }>({ graphId: '', ids: [] });
  const [message, setMessage] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string | null } | null>(null);
  if (!graph) return null;
  const ids = selection.graphId === graph.id ? selection.ids : [];
  const run = (label: string, action: () => void) => {
    const batch = startBatch(label);
    try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { if (batch.opened) endBatch(); }
  };
  const add = (type: string) => run('Add color node', () => {
    const id = actions.addNode(type as ColorNodeType);
    if (id) onSelectNode(id);
    setMenu(null);
  });
  const addOptions = NODE_TYPES.map(item => ({ ...item,
    disabled: (['primary', 'wheels'].includes(item.value) && addNodeDisabled)
      || (item.value === 'alpha-output' && graph.nodes.some(node => node.binding?.kind === 'color-node' && node.binding.nodeType === 'alpha-output')),
  }));
  return <div className="color-shared-node-view" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button')?.blur();
  }}>
    <div className="color-shared-node-actions"><InspectorSelect ariaLabel="Add color node" value=""
      options={[{ value: '', label: 'Add color node…' }, ...addOptions]} onChange={add} /></div>
    {message && <div role="status" className="node-workspace-graph-message">{message}</div>}
    <NodeGraphCanvas key={graph.id} graph={graph} selectedNodeId={selectedNodeId ?? null} selectedNodeIds={ids}
      onSelectNode={id => { setSelection({ graphId: graph.id, ids: [id] }); onSelectNode(id); }}
      onToggleNodeSelection={id => {
        const current = ids.length ? ids : selectedNodeId ? [selectedNodeId] : [];
        setSelection({ graphId: graph.id, ids: current.includes(id) ? current.filter(value => value !== id) : [...current, id] });
        onSelectNode(id);
      }}
      onMoveNode={(id, layout) => run('Move color node', () => actions.moveNode(id, layout))}
      onMoveNodes={moves => run('Move color nodes', () => moves.forEach(move => actions.moveNode(move.nodeId, move.layout)))}
      onConnectPorts={connection => run('Connect color ports', () => actions.connectPorts(connection))}
      onDisconnectEdge={id => run('Disconnect color link', () => actions.disconnectEdge(id))}
      onReconnectPorts={(id, connection) => run('Reconnect color link', () => reconnectNodePorts(graph, id, connection,
        () => readTimelineRuntimeState(useTimelineStore).clips, actions.connectPorts, actions.disconnectEdge))}
      onDeleteNode={id => run('Delete color node', () => actions.deleteNode(id))}
      onDeleteNodes={nodeIds => run('Delete color nodes', () => nodeIds.forEach(actions.deleteNode))}
      onToggleNodeBypass={id => run('Toggle color bypass', () => actions.toggleBypass(id))}
      onOpenAddMenu={setMenu} />
    {menu && <div className="node-workspace-context-backdrop" onClick={() => setMenu(null)} onContextMenu={event => { event.preventDefault(); setMenu(null); }}>
      <div className="node-workspace-context-menu" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 220)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 380)) }}
        onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setMenu(null); }}>
        {addOptions.map(item => <button key={item.value} type="button" disabled={item.disabled} onClick={() => add(item.value)}>Add {item.label}</button>)}
        {menu.nodeId && <button type="button" onClick={() => { run('Delete color node', () => actions.deleteNode(menu.nodeId!)); setMenu(null); }}>Delete Node</button>}
      </div>
    </div>}
  </div>;
}
