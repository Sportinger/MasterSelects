import { useLayoutEffect, useRef, useState } from 'react';
import type { NodeCanvasPlacement, NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import type { NodeLayoutSnapshot } from './nodeLayoutTransition';
import { createNodeGroupFoldSequence, type ProjectGroupStates } from './nodeGroupFoldSequence';

/** Only presentation is animated; durable placement always contains the target. */
export function useNodeLayoutTransition(graph: NodeGraph, nodes: NodeGraphNode[], dragging: boolean,
  placement?: NodeCanvasPlacement, project?: ProjectGroupStates): NodeLayoutSnapshot & { animating: boolean } {
  const [shown, setShown] = useState({ graph, nodes, animating: false });
  const current = useRef<NodeLayoutSnapshot>(shown);
  const wasDragging = useRef(dragging);
  const previousPlacement = useRef(placement);
  useLayoutEffect(() => {
    const target = { graph, nodes }, before = current.current;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const transition = createNodeGroupFoldSequence(before, target, previousPlacement.current, project);
    previousPlacement.current = placement;
    const direct = dragging || wasDragging.current;
    wasDragging.current = dragging;
    let frame = 0;
    const publish = (value: NodeLayoutSnapshot, animating = false) => { current.current = value; setShown({ ...value, animating }); };
    const finish = () => { cancelAnimationFrame(frame); publish(target); };
    if (direct || motion.matches || before.graph.id !== graph.id || !transition.changed) { finish(); return; }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / transition.duration);
      publish(transition.sample(progress), progress < 1);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    publish(transition.sample(0), true);
    frame = requestAnimationFrame(tick);
    motion.addEventListener('change', finish);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', finish); };
  }, [graph, nodes, dragging, placement, project]);
  return shown;
}
