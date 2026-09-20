import { readTimelineRuntimeState } from '../../../../../services/timeline/timelineRuntimeCoordinator';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../../../stores/timeline';
import { clipLocalToKeyframeTime } from '../../../../../services/flock/time/flockKeyframeTime';
import type { Viewport } from '../canvasGeometry';
import { buildCanvasScene } from './buildCanvasScene';
import { canvasPixelRatio, createNodeCanvasRuntime } from './nodeCanvasRuntime';
import type { CanvasTheme } from './nodeCanvasTypes';
import { NodePreviewController } from '../../previews/NodePreviewController';
import './NodeGraphCanvasSurface.css';

type SceneOptions = Parameters<typeof buildCanvasScene>[0];
type Props = Omit<SceneOptions, 'clips' | 'keyframes' | 'sourceTime'> & { viewport: Viewport; onReady: (ready: boolean) => void };

export const NodeGraphCanvasSurface = memo(function NodeGraphCanvasSurface({ viewport, onReady, ...options }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<ReturnType<typeof createNodeCanvasRuntime> | null>(null);
  const previewRuntime = useRef<NodePreviewController | null>(null);
  const clips = useTimelineStore(state => state.clips);
  const keyframes = useTimelineStore(state => state.clipKeyframes);
  const sourceTime = useTimelineStore(state => state.getSourceTimeForClip);
  const { graph, nodes, groupFrameNodes, plugs, selection, selectedNodeId, selectedEdgeId, hoveredEdgeId, hoveredPort, draft, canBypass } = options;
  const scene = useMemo(() => buildCanvasScene({ graph, nodes, plugs, selection, selectedNodeId, selectedEdgeId,
    hoveredEdgeId, hoveredPort, draft, clips, keyframes, sourceTime, canBypass, groupFrameNodes }),
  [graph, nodes, groupFrameNodes, plugs, selection, selectedNodeId, selectedEdgeId, hoveredEdgeId, hoveredPort, draft, clips, keyframes, sourceTime, canBypass]);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const previewSource = useRef({ clipId: graph.owner.id, nodes, selectedNodeId, expanded: graph.expandedNodes }); previewSource.current = { clipId: graph.owner.id, nodes, selectedNodeId, expanded: graph.expandedNodes };
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const refreshRef = useRef<() => void>(() => {});
  const viewRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = createNodeCanvasRuntime(host, ready => { onReady(ready); previewRuntime.current?.reset(); }); runtime.current = renderer;
    const previews = new NodePreviewController(renderer, host); previewRuntime.current = previews;
    previews.scene(previewSource.current.clipId, previewSource.current.nodes, previewSource.current.selectedNodeId, previewSource.current.expanded);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true, fade: ReturnType<typeof setTimeout> | undefined, frame: number | undefined;
    let lastPosition = readTimelineRuntimeState(useTimelineStore).playheadPosition, scrubUntil = 0;
    const transport = () => {
      frame = undefined;
      const state = readTimelineRuntimeState(useTimelineStore), sourceTimes: Record<string, number> = {};
      previews.visibility(visible && !document.hidden);
      if (visible && !document.hidden) for (const node of sceneRef.current.nodes) {
        const curve = node.curve;
        if (!curve?.sourceTime || curve.clipId in sourceTimes) continue;
        const clip = state.clips.find(c => c.id === curve.clipId);
        if (clip) sourceTimes[clip.id] = clipLocalToKeyframeTime(clip, curve.property, Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)), state.getSourceTimeForClip);
      }
      renderer.update({ type: 'transport', transport: { playhead: state.playheadPosition, playing: state.isPlaying,
        active: state.isPlaying || performance.now() < scrubUntil, visible: visible && !document.hidden, reducedMotion: motion.matches, sourceTimes,
        playbackSpeed: state.playbackSpeed, timestamp: performance.now() } });
    };
    const queueTransport = () => { if (frame === undefined) frame = requestAnimationFrame(transport); };
    refreshRef.current = queueTransport;
    let size = { width: host.clientWidth, height: host.clientHeight };
    let theme: CanvasTheme;
    const view = () => {
      const measured = { ...viewportRef.current, ...size, ratio: canvasPixelRatio(size.width, size.height, devicePixelRatio) };
      renderer.update({ type: 'view', view: measured, theme }); previews.viewport(measured);
    };
    const measure = () => {
      const width = host.clientWidth, height = host.clientHeight;
      size = { width, height };
      const style = getComputedStyle(host);
      const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
      theme = { background: read('--bg-primary', '#181818'), card: read('--bg-secondary', '#202020'), text: read('--text-primary', '#ddd'),
        muted: read('--text-secondary', '#999'), border: read('--border-color', '#444'), accent: read('--accent-color', read('--accent', '#79b8fa')) };
      view();
    };
    viewRef.current = view;
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure); resize?.observe(host);
    const themeObserver = new MutationObserver(measure);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false; queueTransport();
    }); intersection?.observe(host);
    renderer.update({ type: 'scene', scene: sceneRef.current }); measure(); transport();
    const unsubscribe = useTimelineStore.subscribe((state, before) => {
      if (state.playheadPosition === lastPosition && state.isPlaying === before.isPlaying && state.playbackSpeed === before.playbackSpeed) return;
      if (state.playheadPosition !== lastPosition && !state.isPlaying && !before.isPlaying) {
        scrubUntil = performance.now() + 180; clearTimeout(fade); fade = setTimeout(queueTransport, 190);
      }
      if (state.isPlaying !== before.isPlaying) { scrubUntil = 0; clearTimeout(fade); }
      lastPosition = state.playheadPosition;
      if ((visible && !document.hidden) || state.isPlaying !== before.isPlaying) queueTransport();
    });
    document.addEventListener('visibilitychange', queueTransport); motion.addEventListener('change', queueTransport);
    window.addEventListener('resize', measure);
    return () => {
      unsubscribe(); resize?.disconnect(); intersection?.disconnect(); themeObserver.disconnect(); clearTimeout(fade);
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', queueTransport); motion.removeEventListener('change', queueTransport);
      window.removeEventListener('resize', measure); previews.dispose(); previewRuntime.current = null; renderer.dispose(); runtime.current = null;
    };
  }, [onReady]);
  useLayoutEffect(() => { runtime.current?.update({ type: 'scene', scene }); refreshRef.current(); }, [scene]);
  useLayoutEffect(() => { previewRuntime.current?.scene(graph.owner.id, nodes, selectedNodeId, graph.expandedNodes); }, [graph.owner.id, nodes, selectedNodeId, graph.expandedNodes]);
  useLayoutEffect(() => { viewRef.current(); }, [viewport]);
  return <div ref={hostRef} className="node-graph-canvas-surface" aria-hidden="true" />;
});
