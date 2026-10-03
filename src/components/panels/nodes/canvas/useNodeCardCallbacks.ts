import { useMemo, useRef } from 'react';
import type { NodeGraphNodeCardProps } from './NodeGraphNodeCard';

type Callbacks = Pick<NodeGraphNodeCardProps, 'onToggleGroup' | 'onSelectNode' | 'onSelectSummarySegment'
  | 'onStartNodeDrag' | 'onNodePointerMove' | 'onFinishNodeDrag' | 'onStartConnectionDrag'
  | 'onDisconnectPortEdges' | 'onToggleNodeBypass' | 'onTogglePreview' | 'onPreviewOutput'>;

/** Card event handlers always read the current canvas, without invalidating every
 * memoized card when a timeline edit replaces graph-dependent closures. */
export function useNodeCardCallbacks(callbacks: Callbacks): Callbacks {
  const latest = useRef(callbacks); latest.current = callbacks;
  const enabled = Object.keys(callbacks).filter(key => !!callbacks[key as keyof Callbacks]).join(',');
  return useMemo(() => Object.fromEntries(enabled.split(',').filter(Boolean).map(key => [key,
    (...args: unknown[]) => (latest.current[key as keyof Callbacks] as ((...values: unknown[]) => unknown) | undefined)?.(...args),
  ])) as Callbacks, [enabled]);
}
