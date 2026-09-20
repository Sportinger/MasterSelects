import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeGraphCanvas } from '../../src/components/panels/nodes/NodeGraphCanvas';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { ensureColorCorrectionState, compileRuntimeColorGrade } from '../../src/types/colorCorrection';
import { buildClipColorNodeGraph } from '../../src/services/nodeGraph/clipGraphDocument';
import { foldOperatorGroups } from '../../src/services/nodeGraph/nestedOperatorGroups';
import { Compositor } from '../../src/engine/render/Compositor';
import { CompositorPipeline } from '../../src/engine/pipeline/CompositorPipeline';
import { ColorPipeline } from '../../src/engine/color/ColorPipeline';
import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { MaskTextureManager } from '../../src/engine/texture/MaskTextureManager';
import '../../src/components/panels/nodes/NodeWorkspacePanel.css';

if (new URLSearchParams(location.search).has('software')) Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { configurable: true, value: undefined });
const image = document.createElement('canvas'); image.width = 180; image.height = 320;
const paint = image.getContext('2d')!;
paint.fillStyle = '#e96c30'; paint.fillRect(0, 0, 90, 320); paint.fillStyle = '#238dce'; paint.fillRect(90, 0, 90, 320);
paint.fillStyle = 'white'; paint.beginPath(); paint.arc(90, 160, 60, 0, Math.PI * 2); paint.fill();
const clip = createMockClip({ id: 'preview-fixture', duration: 600, outPoint: 600,
  source: { type: 'text', textCanvas: image }, colorCorrection: ensureColorCorrectionState() });
useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], playheadPosition: 0 });

async function startRenderer(report: (value: string) => void) {
  const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
  const errors: string[] = [];
  device.addEventListener('uncapturederror', event => { errors.push(event.error.message); report(`GPU ERROR: ${event.error.message}`); });
  const pipeline = new CompositorPipeline(device); await pipeline.createPipelines();
  const colors = new ColorPipeline(device); await colors.createPipeline();
  const effects = new EffectsPipeline(device); await effects.createPipelines();
  const compositor = new Compositor(pipeline, effects, new MaskTextureManager(device), colors);
  const textures = Array.from({ length: 5 }, () => device.createTexture({ size: [180, 320], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST }));
  device.queue.copyExternalImageToTexture({ source: image }, { texture: textures[0] }, [180, 320]);
  const views = textures.map(texture => texture.createView()), sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  let active = true, start = performance.now(), frames = 0, totalMs = 0, maxMs = 0;
  const timer = setInterval(() => {
    if (!active || document.hidden) return;
    const before = performance.now(), state = useTimelineStore.getState(), current = state.clips[0];
    if (state.isPlaying) useTimelineStore.setState({ playheadPosition: (performance.now() - start) / 1000 });
    const encoder = device.createCommandEncoder();
    compositor.composite([{ layer: { id: clip.id, sourceClipId: clip.id, name: 'Fixture', visible: true, source: { type: 'image' }, ...clip.transform,
      colorCorrection: compileRuntimeColorGrade(current.colorCorrection), effects: [] }, isVideo: false, textureView: views[0], externalTexture: null, sourceWidth: 180, sourceHeight: 320 }],
    encoder, { device, sampler, pingView: views[1], pongView: views[2], effectTempView: views[3], effectTempView2: views[4], outputWidth: 180, outputHeight: 320 });
    device.queue.submit([encoder.finish()]);
    const elapsed = performance.now() - before; frames++; totalMs += elapsed; maxMs = Math.max(maxMs, elapsed);
    if (frames % 60 === 0 && !errors.length) report(`GPU OK; ${frames} frames; CPU mean ${(totalMs / frames).toFixed(2)}ms; max ${maxMs.toFixed(2)}ms`);
  }, 33);
  report('GPU OK');
  return () => { active = false; clearInterval(timer); textures.forEach(texture => texture.destroy()); compositor.destroy(); colors.destroy(); };
}

function Probe() {
  const [count, setCount] = useState(3), [selected, setSelected] = useState<string | null>(null), [status, setStatus] = useState('Starting GPU');
  const [groupMode, setGroupMode] = useState(false), [groups, setGroups] = useState<Record<string, { collapsed: boolean }>>({});
  const current = useTimelineStore(state => state.clips[0]), playing = useTimelineStore(state => state.isPlaying);
  useEffect(() => { let cleanup: (() => void) | undefined; void startRenderer(setStatus).then(value => cleanup = value).catch(error => setStatus(String(error))); return () => cleanup?.(); }, []);
  const colorGraph = buildClipColorNodeGraph(current)!;
  const grouped = { ...colorGraph, nodes: Array.from({ length: 7 }, (_, i) => ({ ...colorGraph.nodes.at(-1)!, id: `group-${i}`, layout: { x: (i % 3) * 200, y: Math.floor(i / 3) * 220 } })), edges: [], groups: [
    { id: 'effect', label: 'Effect', proxyId: 'effect-proxy', nodeIds: ['group-0', 'group-1', 'group-2', 'group-3'] },
    { id: 'surface', label: 'Surface', parentId: 'effect', proxyId: 'surface-proxy', nodeIds: ['group-0', 'group-3'] },
    { id: 'physics', label: 'Physics', parentId: 'effect', proxyId: 'physics-proxy', nodeIds: ['group-1', 'group-2'] },
    { id: 'scene', label: 'Scene', proxyId: 'scene-proxy', nodeIds: ['group-4', 'group-5'] },
  ] };
  const graph = groupMode ? foldOperatorGroups(grouped, { groups }) : count === 3 ? colorGraph : { ...colorGraph, nodes: Array.from({ length: count }, (_, i) => ({ ...colorGraph.nodes.at(-1)!, id: `stress-${i}`, layout: { x: (i % 16) * 230, y: Math.floor(i / 16) * 470 } })), edges: [] };
  const grade = (exposure: number) => useTimelineStore.setState(state => ({ clips: state.clips.map(value => ({ ...value, colorCorrection: { ...value.colorCorrection!, versions: value.colorCorrection!.versions.map(version => ({ ...version, nodes: version.nodes.map(node => node.type === 'primary' ? { ...node, params: { ...node.params, exposure } } : node) })) } })) }));
  return <main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <style>{`:root { --bg-secondary:#202020;--bg-primary:#171717;--border-color:#444;--text-muted:#aaa;--text-primary:#eee;--accent:#2d8ceb } *{box-sizing:border-box}body{margin:0;background:#171717;color:#eee;font:14px sans-serif}.node-workspace-board{flex:1}.bar{display:flex;gap:12px;padding:12px}button:focus:not(:focus-visible){outline:none}button:focus-visible{outline:2px solid #2d8ceb}`}</style>
    <div className="bar"><button onClick={() => { setGroupMode(false); setCount(3); }}>Color stages</button>{[16, 64, 128, 1000].map(value => <button key={value} onClick={() => { setGroupMode(false); setCount(value); }}>{value} previews</button>)}
      <button onClick={() => setGroupMode(true)}>Nested groups</button>
      <button onClick={() => grade(0)}>Neutral grade</button><button onClick={() => grade(-2)}>Exposure −2</button>
      <button onClick={() => useTimelineStore.setState({ isPlaying: !playing })}>{playing ? 'Pause' : 'Play'}</button><output>{status}</output></div>
    <NodeGraphCanvas graph={graph} selectedNodeId={selected} onSelectNode={setSelected}
      onToggleGroup={id => setGroups(previous => ({ ...previous, [id]: { collapsed: !previous[id]?.collapsed } }))} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
