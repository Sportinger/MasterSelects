import { readTimelineRuntimeState } from '../../../../../services/timeline/timelineRuntimeCoordinator';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MutableRefObject, type RefObject } from 'react';
import { useTimelineStore } from '../../../../../stores/timeline';
import { useSettingsStore } from '../../../../../stores/settingsStore';
import { clipLocalToKeyframeTime } from '../../../../../services/flock/time/flockKeyframeTime';
import type { Viewport } from '../canvasGeometry';
import { buildCanvasScene } from './buildCanvasScene';
import { bufferedCanvasView, createNodeCanvasRuntime, NODE_CANVAS_OVERSCAN } from './nodeCanvasRuntime';
import type { CanvasTheme } from './nodeCanvasTypes';
import type { CanvasNodeDrag } from './canvasNodeDrag';
import { NodePreviewController } from '../../previews/NodePreviewController';
import './NodeGraphCanvasSurface.css';

type SceneOptions = Parameters<typeof buildCanvasScene>[0];
type Props = Omit<SceneOptions, 'clips' | 'keyframes' | 'sourceTime'> & {
  viewport: Viewport;
  surfaceRef: RefObject<HTMLDivElement | null>;
  backgroundRef: RefObject<HTMLDivElement | null>;
  onReady: (ready: boolean) => void;
  onViewRendered: (viewport: Viewport) => void;
  /** Filled with a direct worker hover channel for pointer hit testing. */
  hoverRef?: MutableRefObject<((edgeId: string | null) => void) | null>;
  /** Filled with a direct channel for pointer-drag offsets; false when no canvas paints them. */
  dragRef?: MutableRefObject<((drag: CanvasNodeDrag | null) => boolean) | null>;
  previewsSuspended?: boolean;
};

export const NodeGraphCanvasSurface = memo(function NodeGraphCanvasSurface({ viewport, surfaceRef, backgroundRef, onReady, onViewRendered, previewsSuspended = false, hoverRef, dragRef, ...options }: Props) {
  const runtime = useRef<ReturnType<typeof createNodeCanvasRuntime> | null>(null);
  const previewRuntime = useRef<NodePreviewController | null>(null);
  const suspendedRef = useRef(previewsSuspended); suspendedRef.current = previewsSuspended;
  const clips = useTimelineStore(state => state.clips);
  const keyframes = useTimelineStore(state => state.clipKeyframes);
  const sourceTime = useTimelineStore(state => state.getSourceTimeForClip);
  const cableStyle = useSettingsStore(state => state.nodeCableStyle);
  const { graph, nodes, groupFrameNodes, groupBounds, plugs, selection, selectedNodeId, selectedEdgeId, hoveredEdgeId, hoveredPort, draft, canBypass, glideMs, cables, edgeRoots, branches } = options;
  const scene = useMemo(() => buildCanvasScene({ graph, nodes, plugs, selection, selectedNodeId, selectedEdgeId,
    hoveredEdgeId: null, hoveredPort, draft, clips, keyframes, sourceTime, canBypass, groupFrameNodes, groupBounds, glideMs, cableStyle, cables, edgeRoots, branches }),
  [graph, nodes, groupFrameNodes, groupBounds, plugs, selection, selectedNodeId, selectedEdgeId, hoveredPort, draft, clips, keyframes, sourceTime, canBypass, glideMs, cableStyle, cables, edgeRoots, branches]);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const previewSource = useRef({ clipId: graph.owner.id, nodes, selectedNodeId, expanded: graph.expandedNodes }); previewSource.current = { clipId: graph.owner.id, nodes, selectedNodeId, expanded: graph.expandedNodes };
  const viewportRef = useRef(viewport); viewportRef.current = viewport;
  const refreshRef = useRef<() => void>(() => {});
  const viewRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = surfaceRef.current;
    if (!host) return;
    let latestViewRevision = 0;
    const renderedViews = new Map<number, Viewport>();
    const renderer = createNodeCanvasRuntime(host, ready => { onReady(ready); previewRuntime.current?.reset(); }, revision => {
      const rendered = renderedViews.get(revision);
      for (const key of renderedViews.keys()) if (key < revision) renderedViews.delete(key);
      // An older requested view may be the frame that was just presented.
      // Its transform must be acknowledged even while a newer request is pending.
      if (rendered) onViewRendered(rendered);
    }); runtime.current = renderer;
    const previews = new NodePreviewController(renderer, host); previewRuntime.current = previews;
    if (hoverRef) hoverRef.current = edgeId => renderer.update({ type: 'hover', edgeId });
    if (dragRef) dragRef.current = drag => {
      // Until a canvas paints (and in the DOM fallback) the visible cards move in React.
      if (host.dataset.renderer !== 'worker' && host.dataset.renderer !== 'software') return false;
      renderer.update({ type: 'drag', drag }); return true;
    };
    previews.suspend(suspendedRef.current);
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
      const viewport = viewportRef.current;
      const measured = bufferedCanvasView({ ...viewport, ...size, moving: suspendedRef.current }, devicePixelRatio);
      const revision = ++latestViewRevision;
      // Presentation correction uses the logical viewport; canvas pixels have
      // their own padded origin, offset back by CSS on every rendering layer.
      renderedViews.set(revision, viewport);
      renderer.update({ type: 'view', view: measured, theme, revision }); previews.viewport(measured);
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
      if (hoverRef) hoverRef.current = null;
      if (dragRef) dragRef.current = null;
    };
  }, [onReady, onViewRendered, surfaceRef, hoverRef, dragRef]);
  useLayoutEffect(() => { runtime.current?.update({ type: 'scene', scene }); refreshRef.current(); }, [scene]);
  useLayoutEffect(() => { previewRuntime.current?.suspend(previewsSuspended); }, [previewsSuspended]);
  // Edge hover is drawn on the worker overlay; it never rebuilds or clones the scene.
  useLayoutEffect(() => { runtime.current?.update({ type: 'hover', edgeId: hoveredEdgeId }); }, [hoveredEdgeId]);
  useLayoutEffect(() => { previewRuntime.current?.scene(graph.owner.id, nodes, selectedNodeId, graph.expandedNodes); }, [graph.owner.id, nodes, selectedNodeId, graph.expandedNodes]);
  useLayoutEffect(() => { viewRef.current(); }, [viewport, previewsSuspended]);
  return <>
    {/* Group fills are cheap vector rectangles. Keep their full geometry on the
        immediate visual transform so zooming out never exposes a bitmap edge. */}
    <div ref={backgroundRef} className="node-graph-group-backgrounds" aria-hidden="true">
      {scene.groups.map((group, index) => <div key={index} style={{ left: group.x, top: group.y,
        width: group.width, height: group.height, '--group-color': group.color } as CSSProperties} />)}
    </div>
    <div ref={surfaceRef} className="node-graph-canvas-surface" aria-hidden="true"
      style={{ '--node-canvas-overscan': `${NODE_CANVAS_OVERSCAN}px` } as CSSProperties} />
  </>;
});
