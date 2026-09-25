import { useCallback, useMemo, useRef, type RefObject } from 'react';
import type { NodeGraphPoint, Viewport } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';
import { createEdgeHitIndex } from './edgeHitIndex';
import { useSettingsStore } from '../../../../stores/settingsStore';

/** Canvas mode mounts no per-cable DOM hit paths. */
export const NO_EDGE_TARGETS: ReadonlySet<string> = new Set();
/** Screen pixels around a cable that count as touching it. */
const HIT_TOLERANCE_PX = 6;
/** A press that moves further than this pans the canvas instead of selecting. */
const CLICK_SLOP_PX = 4;

/**
 * Canvas-mode cable hits without DOM hit targets. Hover goes straight to the
 * canvas worker (no React render); click and context menu resolve the cable
 * under the pointer from the same index.
 */
export function useCanvasEdgeHits(options: {
  enabled: boolean;
  plugs: ConnectionPlug[];
  canvas: RefObject<HTMLDivElement | null>;
  visual: RefObject<Viewport>;
  getGraphPoint: (clientX: number, clientY: number) => NodeGraphPoint;
  hover: RefObject<((edgeId: string | null) => void) | null>;
}) {
  const { enabled, plugs, canvas, visual, getGraphPoint, hover } = options;
  const cableStyle = useSettingsStore(state => state.nodeCableStyle);
  const index = useMemo(() => {
    if (!enabled) return null;
    const pairs = new Map<string, { from?: NodeGraphPoint; to?: NodeGraphPoint }>();
    for (const plug of plugs) {
      const pair = pairs.get(plug.edge.id) ?? {};
      if (plug.port.direction === 'output') pair.from = plug.tip; else pair.to = plug.tip;
      pairs.set(plug.edge.id, pair);
    }
    return createEdgeHitIndex([...pairs].flatMap(([id, pair]) => pair.from && pair.to ? [{ id, from: pair.from, to: pair.to }] : []), cableStyle);
  }, [enabled, plugs, cableStyle]);
  const last = useRef<NodeGraphPoint | null>(null);
  const hovered = useRef<string | null>(null);

  const show = useCallback((edgeId: string | null) => {
    if (hovered.current === edgeId) return;
    hovered.current = edgeId;
    hover.current?.(edgeId);
    if (canvas.current) canvas.current.style.cursor = edgeId ? 'pointer' : '';
  }, [canvas, hover]);

  const tolerance = useCallback(() => HIT_TOLERANCE_PX / Math.max(1e-6, visual.current.zoom), [visual]);

  /** Pointer move without buttons: swept hit test since the previous sample. */
  const move = useCallback((clientX: number, clientY: number) => {
    if (!index) return;
    const point = getGraphPoint(clientX, clientY);
    show(index.query(last.current ?? point, point, tolerance()));
    last.current = point;
  }, [getGraphPoint, index, show, tolerance]);

  const at = useCallback((clientX: number, clientY: number): string | null => {
    if (!index) return null;
    const point = getGraphPoint(clientX, clientY);
    return index.query(point, point, tolerance());
  }, [getGraphPoint, index, tolerance]);

  const leave = useCallback(() => { last.current = null; show(null); }, [show]);

  // Pressing on a cable still pans; only a release without travel selects it.
  const pressed = useRef<{ edgeId: string; x: number; y: number } | null>(null);
  const press = useCallback((clientX: number, clientY: number) => {
    const edgeId = at(clientX, clientY);
    pressed.current = edgeId ? { edgeId, x: clientX, y: clientY } : null;
  }, [at]);
  const release = useCallback((clientX: number, clientY: number): string | null => {
    const press = pressed.current;
    pressed.current = null;
    return press && Math.hypot(clientX - press.x, clientY - press.y) <= CLICK_SLOP_PX ? press.edgeId : null;
  }, []);

  return { move, at, leave, press, release };
}
