import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { NodeWorkspacePanel } from '../../src/components/panels/nodes/NodeWorkspacePanel';
import { useNodeWorkspaceNavigation } from '../../src/services/nodeGraph/nodeWorkspaceNavigation';
import { compileVoxelGraph } from '../../src/services/operators/voxelGraph';
import { initHistoryStoreRefs, useHistoryStore, captureSnapshot, undo, redo } from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';
import { checkVoxelGpu, startVoxelProbeSource } from './voxel-gpu-check';
import '../../src/styles/tokens.css';
import '../../src/styles/themes/resolve.css';
import '../../src/styles/base.css';
import '../../src/styles/shared-controls.css';

const clip = createMockClip({ id: 'voxel-fixture', name: 'Isolated Voxel fixture', source: { type: 'image' },
  effects: [{ id: 'relief', type: 'voxel-relief', name: 'Voxel Relief', enabled: true, params: {} }] });
useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], selectedClipIds: new Set([clip.id]), primarySelectedClipId: clip.id, playheadPosition: 0 });
initHistoryStoreRefs({ timeline: useTimelineStore, media: useMediaStore, dock: useDockStore });
useHistoryStore.getState().clearHistory(); captureSnapshot('Voxel fixture');
useNodeWorkspaceNavigation.getState().requestView(clip.id, 'effect:relief');

function Probe() {
  useEffect(() => { let stopped = false, dispose: (() => void) | undefined;
    void startVoxelProbeSource().then(cleanup => { if (stopped) cleanup(); else dispose = cleanup; });
    return () => { stopped = true; dispose?.(); };
  }, []);
  const [status, setStatus] = useState('Isolated fixture; no user project loaded.');
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useTimelineStore(state => state.clips[0]);
  const plan = compileVoxelGraph(current.effects[0].params);
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{`body{margin:0;background:#171717;color:#eee;font:13px sans-serif}*{box-sizing:border-box}.node-workspace-board{flex:1}button:focus:not(:focus-visible){outline:none}button:focus-visible{outline:2px solid #2d8ceb}`}</style>
    <div style={{ display: 'flex', gap: 12, padding: 8, alignItems: 'start' }}>
      <button onClick={() => { setStatus('Checking production GPU shaders…'); void checkVoxelGpu(canvas.current!).then(setStatus).catch(error => setStatus(`FAILED: ${error.message}`)); }}>Check GPU pixels</button>
      <button onClick={() => undo()}>Undo fixture</button><button onClick={() => redo()}>Redo fixture</button>
      <button onClick={() => { useTimelineStore.setState({ clips: [{ ...current, effects: JSON.parse(JSON.stringify(current.effects)) }] }); setStatus('Saved graph restored.'); }}>Save and reload fixture</button>
      <output style={{ whiteSpace: 'pre-wrap' }}>{status}<br />Height bound: {plan.maxHeight.toFixed(3)}; instructions: {plan.field.operations.length}; visible: {String(plan.visible)}</output>
      <canvas ref={canvas} width={256} height={128} aria-label="Production 2D and native 3D GPU outputs" />
    </div>
    <div style={{ flex: 1, minHeight: 0 }}><NodeWorkspacePanel /></div>
  </main>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.dispose(data => { data.root = root; });
root.render(<Probe />);
