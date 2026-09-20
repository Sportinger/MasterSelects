import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { createDefaultColorCorrectionState } from '../../src/types/colorCorrection';
import { NodeWorkspacePanel } from '../../src/components/panels/nodes/NodeWorkspacePanel';
import { ColorEditor } from '../../src/components/panels/color/ColorEditor';
import { compileFlockDefinitionCached } from '../../src/services/flock/compiler/flockCompiler';
import { cloneClipNodeGraph } from '../../src/services/nodeGraph/clipGraphProjectionState';
import { initHistoryStoreRefs, useHistoryStore, captureSnapshot, undo, redo } from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import '../../src/styles/tokens.css';
import '../../src/styles/themes/resolve.css';
import '../../src/styles/base.css';
import '../../src/styles/shared-controls.css';

if (new URLSearchParams(location.search).has('software')) Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: undefined });
const clips = [createMockClip({ id: 'fixture-flock', name: 'Flock fixture', source: { type: 'flock', naturalDuration: 10 },
  flock: createFlockPresetDefinition('free-swarm'), is3D: true, duration: 10, outPoint: 10 }),
  createMockClip({ id: 'fixture-color', name: 'Color fixture', source: { type: 'image' }, colorCorrection: createDefaultColorCorrectionState() })];
useTimelineStore.setState({ clips, tracks: [createMockTrack({ id: clips[0].trackId })], selectedClipIds: new Set([clips[0].id]), primarySelectedClipId: clips[0].id, playheadPosition: 1 });
initHistoryStoreRefs({ timeline: useTimelineStore, media: useMediaStore, dock: useDockStore });
useHistoryStore.getState().clearHistory();
captureSnapshot('Fixture');

function Probe() {
  const [view, setView] = useState('flock'), [status, setStatus] = useState('Isolated fixtures; no project is loaded.');
  const current = useTimelineStore(state => state.clips);
  const flock = current.find(clip => clip.id === 'fixture-flock')!;
  const compiled = compileFlockDefinitionCached(flock.flock!);
  const choose = (next: string) => {
    const id = next === 'flock' ? 'fixture-flock' : 'fixture-color';
    useTimelineStore.setState({ selectedClipIds: new Set([id]), primarySelectedClipId: id }); setView(next);
  };
  const roundtrip = () => {
    // Serialize durable graph definitions only; media handles remain runtime-owned.
    const restored = current.map(clip => ({ ...clip,
      flock: clip.flock && JSON.parse(JSON.stringify(clip.flock)),
      colorCorrection: clip.colorCorrection && JSON.parse(JSON.stringify(clip.colorCorrection)),
      nodeGraph: cloneClipNodeGraph(clip.nodeGraph),
    }));
    useTimelineStore.setState({ clips: restored });
    setStatus(compileFlockDefinitionCached(restored[0].flock!).ok ? 'Saved definitions restored; Flock compiles.' : 'Flock invalid');
  };
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{`:root{--bg-primary:#171717;--bg-secondary:#202020;--bg-tertiary:#292929;--border-color:#444;--text-primary:#eee;--text-secondary:#ccc;--text-muted:#aaa;--accent:#2d8ceb;--accent-primary:#2d8ceb}*{box-sizing:border-box}body{margin:0;background:#171717;color:#eee;font:13px sans-serif}.probe-bar{display:flex;gap:10px;padding:10px}.probe-surface{flex:1;min-height:0}.node-workspace-board{flex:1}button:focus:not(:focus-visible){outline:none}button:focus-visible{outline:2px solid #2d8ceb}`}</style>
    <div className="probe-bar"><button onClick={() => choose('flock')}>Flock Nodes</button><button onClick={() => choose('color')}>Color Nodes</button>
      <button onClick={() => choose('unified')}>Color in Workspace</button><button onClick={roundtrip}>Save and reload fixture</button>
      <button onClick={() => undo()}>Undo fixture</button><button onClick={() => redo()}>Redo fixture</button></div>
    <output style={{ padding: '0 10px 8px' }}>{status} Flock: {compiled.ok ? 'valid' : 'invalid'}; {flock.flock!.nodes.length} nodes / {flock.flock!.edges.length} links.</output>
    <div className="probe-surface">{view === 'color' ? <ColorEditor clipId="fixture-color" workspace /> : <NodeWorkspacePanel />}</div>
  </main>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; });
root.render(<Probe />);
