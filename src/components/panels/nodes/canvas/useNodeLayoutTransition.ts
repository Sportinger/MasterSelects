import { useLayoutEffect, useRef, useState } from 'react';
import type { NodeCanvasPlacement, NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import type { NodeLayoutSnapshot } from './nodeLayoutTransition';
import { createNodeGroupFoldKeyframes, type ProjectGroupStates } from './nodeGroupFoldSequence';
import { NODE_LAYOUT_DURATION } from './nodeLayoutTransition';

/** Only presentation is animated; durable placement always contains the target. */
export function useNodeLayoutTransition(graph: NodeGraph, nodes: NodeGraphNode[], dragging: boolean,
  placement?: NodeCanvasPlacement, project?: ProjectGroupStates): NodeLayoutSnapshot & { animating: boolean; glideMs?: number } {
  const [shown, setShown] = useState<NodeLayoutSnapshot & { animating: boolean; glideMs?: number }>({ graph, nodes, animating: false });
  const current = useRef<NodeLayoutSnapshot>(shown);
  const wasDragging = useRef(dragging);
  const previousPlacement = useRef(placement);
  useLayoutEffect(() => {
    const target = { graph, nodes }, before = current.current;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const transition = createNodeGroupFoldKeyframes(before, target, previousPlacement.current, project);
    previousPlacement.current = placement;
    const direct = dragging || wasDragging.current;
    wasDragging.current = dragging;
    let frame = 0;
    const publish = (value: NodeLayoutSnapshot, animating = false, glideMs?: number) => {
      current.current = value; setShown({ ...value, animating, ...(glideMs ? { glideMs } : {}) });
    };
    const finish = () => { cancelAnimationFrame(frame); publish(target); };
    if (direct || motion.matches || before.graph.id !== graph.id || !transition.changed) { finish(); return; }
    // Only fold-step keyframes are published; the canvas worker eases between
    // them. This loop merely starts steps, so a slow frame never stacks motion.
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = now - started;
      const keyframe = transition.next(elapsed);
      if (!keyframe && transition.done(elapsed)) { publish(target, false, NODE_LAYOUT_DURATION); return; }
      if (keyframe) publish(keyframe, true, NODE_LAYOUT_DURATION);
      frame = requestAnimationFrame(tick);
    };
    publish(transition.next(0) ?? before, true, NODE_LAYOUT_DURATION);
    frame = requestAnimationFrame(tick);
    motion.addEventListener('change', finish);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', finish); };
  }, [graph, nodes, dragging, placement, project]);
  return shown;
}
