import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { memo, useCallback, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import type { ConnectionPlug } from './connectionPlugs';
import { flowSignalTrack } from './flowSignalTrack';
import { useNodeFlowActivity } from './useNodeFlowActivity';
import { NodeFlowClock } from './rendering/NodeFlowClock';
import { useTimelineStore } from '../../../../stores/timeline';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { nodeGroupBounds } from './groupBounds';
import { edgeGroupOcclusion } from './edgeGroupOcclusion';

/** Small HTML layers move along cables; the large SVG stays static during playback. */
export const NodeGraphFlowSignals = memo(function NodeGraphFlowSignals({ plugs, hiddenEdgeId, zoom, graph, frameNodes }: {
  plugs: ConnectionPlug[]; hiddenEdgeId?: string; zoom: number;
  graph?: NodeGraph; frameNodes?: NodeGraphNode[];
}) {
  const syncRef = useRef(() => {});
  const onActivity = useCallback(() => syncRef.current(), []);
  const ref = useNodeFlowActivity<HTMLDivElement>(onActivity);
  const routes = useMemo(() => {
    const bounds = graph ? nodeGroupBounds(graph, frameNodes ?? graph.nodes) : new Map();
    const inputs = new Map(plugs.filter(p => p.port.direction === 'input').map(p => [p.edge.id, p]));
    return plugs.flatMap(output => {
      const input = inputs.get(output.edge.id);
      return output.port.direction !== 'output' || !input || output.edge.readOnly || output.edge.id === hiddenEdgeId ? [] : [{
        id: output.edge.id, color: describeNodePort(output.port).color,
        ...flowSignalTrack(output.tip, input.tip, zoom, graph ? edgeGroupOcclusion(output.edge, graph, bounds) : []),
      }];
    });
  }, [plugs, hiddenEdgeId, zoom, graph, frameNodes]);

  useEffect(() => {
    const root = ref.current;
    if (!root || typeof Element.prototype.animate !== 'function') return;
    root.dataset.flowSupported = 'true';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const entries = routes.map((route, i) => {
      const bounds = root.children[i] as HTMLElement;
      const animations = [...bounds.children].map((signal, point) => {
        const animation = signal.animate(route.keyframes, { duration: route.duration, iterations: Infinity });
        animation.pause();
        animation.currentTime = ((i * 0.61803398875 + point / 2) % 1) * route.duration;
        return animation;
      });
      return { bounds, animations, visible: typeof IntersectionObserver === 'undefined', running: false };
    });
    const clock = new NodeFlowClock();
    let lastRate = -1;
    const updateRate = () => {
      const state = readTimelineRuntimeState(useTimelineStore), now = performance.now();
      clock.update({ playhead: state.playheadPosition, playing: state.isPlaying, playbackSpeed: state.playbackSpeed,
        active: root.dataset.flowActive === 'true', visible: !document.hidden, timestamp: now }, now);
      if (clock.rate !== lastRate) {
        lastRate = clock.rate;
        for (const entry of entries) for (const animation of entry.animations) animation.updatePlaybackRate(lastRate);
      }
    };
    const sync = () => {
      updateRate();
      const active = root.dataset.flowActive === 'true' && !reducedMotion.matches;
      for (const entry of entries) {
        const running = active && entry.visible;
        if (entry.running === running) continue;
        entry.running = running;
        for (const animation of entry.animations) { if (running) animation.play(); else animation.pause(); }
      }
    };
    syncRef.current = sync;
    const byElement = new Map(entries.map(entry => [entry.bounds, entry]));
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = byElement.get(change.target as HTMLElement);
        if (entry) entry.visible = change.isIntersecting;
      }
      sync();
    }, { root: root.closest('.node-workspace-canvas') });
    entries.forEach(entry => observer?.observe(entry.bounds));
    reducedMotion.addEventListener('change', sync);
    const unsubscribe = useTimelineStore.subscribe((state, before) => {
      if (state.playheadPosition !== before.playheadPosition || state.isPlaying !== before.isPlaying || state.playbackSpeed !== before.playbackSpeed) updateRate();
    });
    sync();
    return () => {
      delete root.dataset.flowSupported;
      syncRef.current = () => {};
      observer?.disconnect();
      reducedMotion.removeEventListener('change', sync);
      unsubscribe();
      entries.forEach(entry => entry.animations.forEach(animation => animation.cancel()));
    };
  }, [routes, ref]);

  return <div ref={ref} className="node-workspace-flow-signals" aria-hidden="true"
    style={{ '--flow-signal-size': `${3 / zoom}px` } as CSSProperties}>
    {routes.map(route => <span key={route.id} className="node-workspace-flow-route" data-flow-edge-id={route.id}
      style={{ left: route.left, top: route.top, width: route.width, height: route.height, '--port-color': route.color } as CSSProperties}>
      <i className="node-workspace-flow-signal" /><i className="node-workspace-flow-signal" />
    </span>)}
  </div>;
});
