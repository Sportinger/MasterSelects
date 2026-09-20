import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import type { NodeGraphConnectionRequest } from '../../src/types/nodeGraph';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import '../../src/components/panels/nodes/NodeWorkspacePanel.css';

// A standalone UI fixture: no timeline, project persistence or media is touched.
function Probe() {
  const [graph, setGraph] = useState(connectionFixture);
  const [selected, setSelected] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState('Ready');
  const connect = (connection: NodeGraphConnectionRequest, oldEdge?: string) => {
    setGraph(current => ({ ...current, edges: [...current.edges.filter(e => e.id !== oldEdge && !(e.toNodeId === connection.toNodeId && e.toPortId === connection.toPortId)),
      { ...connection, id: `${connection.fromNodeId}-${connection.toNodeId}`, type: 'video' }] }));
    setLastAction(`Connected ${connection.fromNodeId} to ${connection.toNodeId}`);
  };
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{`:root { --bg-secondary: #202020; --bg-hover: #292929; --bg-primary: #171717; --border-color: #444; --text-muted: #aaa; --text-primary: #eee; --accent: #2d8ceb; } * { box-sizing: border-box; } body { margin: 0; background: #171717; color: #eee; font-family: sans-serif; } .node-workspace-board { flex: 1; } .probe-bar { display: flex; gap: 24px; padding: 12px; }`}</style>
    <div className="probe-bar"><button onClick={() => { setGraph(connectionFixture); setLastAction('Reset'); }}>Reset fixture</button>
      <output aria-live="polite">{lastAction}; {graph.edges.length} cables</output></div>
    <NodeGraphCanvas graph={graph} selectedNodeId={selected} onSelectNode={setSelected}
      onMoveNode={(nodeId, layout) => setGraph(current => ({ ...current, nodes: current.nodes.map(n => n.id === nodeId ? { ...n, layout } : n) }))}
      onConnectPorts={connect} onReconnectPorts={(id, connection) => connect(connection, id)}
      onDisconnectEdge={id => { setGraph(current => ({ ...current, edges: current.edges.filter(e => e.id !== id) })); setLastAction(`Disconnected ${id}`); }} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Probe />);
