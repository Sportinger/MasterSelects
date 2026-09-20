import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { initHistoryStoreRefs, useHistoryStore, captureSnapshot, undo, redo } from '../../src/stores/historyStore';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { defaultCableOperatorGraph, cableOperatorGraph } from '../../src/services/faceCables/cableOperatorGraph';
import { evaluateGraphForces } from '../../src/services/operators/effectGraph';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphDocument';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { transferNodeGroup } from '../../src/services/nodeGraph/transferNodeGroup';
import { cloneClipNodeGraph } from '../../src/services/nodeGraph/clipGraphProjectionState';
import { operatorGraphPauseReason } from '../../src/services/operators/editableOperatorGraph';
import '../../src/components/panels/nodes/NodeWorkspacePanel.css';

if (new URLSearchParams(location.search).has('software')) Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: undefined });
const source = defaultCableOperatorGraph(), target = defaultCableOperatorGraph();
source.nodes.push({ id: 'gravity', operator: 'forces.gravity', bindings: { strength: 'gravityStrength' } });
source.layout.gravity = { x: 0, y: 400 };
source.edges.push({ id: 'gravity-force', from: 'gravity', output: 'force', to: 'simulation', input: 'forces' });
const clip = createMockClip({ id: 'group-fixture', name: 'Group interaction fixture', source: { type: 'video' }, effects: [
  { id: 'source', name: 'Source Effect', type: 'face-cables', enabled: true, params: { gravityStrength: 7, operatorGraph: JSON.stringify(source) } },
  { id: 'target', name: 'Target Effect', type: 'face-cables', enabled: true, params: { operatorGraph: JSON.stringify(target) } },
] });
useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map() });
initHistoryStoreRefs({ timeline: useTimelineStore, media: useMediaStore, dock: useDockStore });
useHistoryStore.getState().clearHistory(); captureSnapshot('Fixture');

function Probe() {
  const current = useTimelineStore(state => state.clips[0]), [selected, setSelected] = useState<string | null>(null);
  const full = buildUnifiedClipGraph(buildClipNodeGraphDocument(current), current);
  const nodes = full.nodes.filter(node => node.binding?.kind === 'effect-operator' && ['simulation.rope', 'forces.gravity'].includes(node.binding.operator))
    .map(node => ({ ...node, layout: { x: node.binding?.kind === 'effect-operator' && node.binding.effectId === 'target' ? 800 : 100,
      y: node.binding?.kind === 'effect-operator' && node.binding.operator === 'forces.gravity' ? 420 : 100 } }));
  const ids = new Set(nodes.map(node => node.id));
  const graph = { ...full, nodes, groups: full.groups?.filter(group => !group.parentId).map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => ids.has(id)) })),
    edges: full.edges.filter(edge => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)) };
  const force = (id: string) => {
    const effect = current.effects.find(effect => effect.id === id)!;
    return evaluateGraphForces(cableOperatorGraph(effect.params), 'simulation', effect.params, id, [], 0).force[1];
  };
  const toggleGroup = (id: string) => useTimelineStore.getState().updateClip(current.id, { nodeGraph: { ...current.nodeGraph, version: 1,
    nodes: current.nodeGraph?.nodes ?? [], groups: { ...current.nodeGraph?.groups, [id]: { collapsed: !current.nodeGraph?.groups?.[id]?.collapsed } } } });
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{`:root{--bg-primary:#171717;--bg-secondary:#202020;--border-color:#444;--text-primary:#eee;--text-secondary:#bbb;--accent:#2d8ceb}*{box-sizing:border-box}body{margin:0;background:#171717;color:#eee;font:13px sans-serif}.probe-bar{display:flex;align-items:center;gap:12px;padding:12px}.node-workspace-board{flex:1}`}</style>
    <div className="probe-bar"><span>Isolated fixture</span><button onClick={() => undo()}>Undo</button><button onClick={() => redo()}>Redo</button>
      <button onClick={() => useTimelineStore.getState().updateClip(current.id, { effects: JSON.parse(JSON.stringify(current.effects)), nodeGraph: cloneClipNodeGraph(current.nodeGraph) })}>Save and restore</button>
      <output>Source force: {force('source')}; Target force: {force('target')}. {current.effects.map(effect => `${effect.name}: ${operatorGraphPauseReason(effect) ? 'Paused' : 'Ready'}`).join('; ')}</output></div>
    <NodeGraphCanvas graph={graph} selectedNodeId={selected} onSelectNode={setSelected}
      onToggleGroup={toggleGroup} onTransferNodes={(nodeIds, groupId) => { const renamed = transferNodeGroup(current.id, full, nodeIds, groupId); setSelected(renamed[nodeIds[0]]); return renamed; }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
