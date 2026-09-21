import { useLayoutEffect, useRef, useState } from 'react';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { createNodeLayoutTransition, NODE_LAYOUT_DURATION, type NodeLayoutSnapshot } from './nodeLayoutTransition';

/** Only presentation is animated; durable placement always contains the target. */
export function useNodeLayoutTransition(graph: NodeGraph, nodes: NodeGraphNode[], dragging: boolean): NodeLayoutSnapshot {
  const [shown, setShown] = useState<NodeLayoutSnapshot>({ graph, nodes });
  const current = useRef(shown);
  const wasDragging = useRef(dragging);
  useLayoutEffect(() => {
    const target = { graph, nodes }, before = current.current;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const transition = createNodeLayoutTransition(before, target);
    const direct = dragging || wasDragging.current;
    wasDragging.current = dragging;
    let frame = 0;
    const publish = (value: NodeLayoutSnapshot) => { current.current = value; setShown(value); };
    const finish = () => { cancelAnimationFrame(frame); publish(target); };
    if (direct || motion.matches || before.graph.id !== graph.id || !transition.changed) { finish(); return; }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / NODE_LAYOUT_DURATION);
      publish(transition.sample(progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    publish(transition.sample(0));
    frame = requestAnimationFrame(tick);
    motion.addEventListener('change', finish);
    return () => { cancelAnimationFrame(frame); motion.removeEventListener('change', finish); };
  }, [graph, nodes, dragging]);
  return shown;
}
