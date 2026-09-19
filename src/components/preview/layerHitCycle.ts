export interface LayerHitCycleState {
  hitLayerIds: string[];
  index: number;
  point: { x: number; y: number };
  timestamp: number;
}

interface ResolveLayerHitCycleOptions<T extends { id: string }> {
  layers: T[];
  point: { x: number; y: number };
  previous: LayerHitCycleState | null;
  timestamp: number;
}

const REPEATED_TAP_MAX_DELAY_MS = 1_200;
const REPEATED_TAP_POSITION_TOLERANCE_PX = 18;

function hasSameLayerStack(previousIds: string[], layers: Array<{ id: string }>): boolean {
  return previousIds.length === layers.length
    && previousIds.every((id, index) => id === layers[index]?.id);
}

export function resolveLayerHitCycle<T extends { id: string }>({
  layers,
  point,
  previous,
  timestamp,
}: ResolveLayerHitCycleOptions<T>): { layer: T | null; state: LayerHitCycleState | null } {
  if (layers.length === 0) return { layer: null, state: null };

  const repeatedTap = previous !== null
    && timestamp >= previous.timestamp
    && timestamp - previous.timestamp <= REPEATED_TAP_MAX_DELAY_MS
    && Math.hypot(point.x - previous.point.x, point.y - previous.point.y)
      <= REPEATED_TAP_POSITION_TOLERANCE_PX
    && hasSameLayerStack(previous.hitLayerIds, layers);
  const index = repeatedTap ? (previous.index + 1) % layers.length : 0;
  return {
    layer: layers[index] ?? null,
    state: {
      hitLayerIds: layers.map(layer => layer.id),
      index,
      point,
      timestamp,
    },
  };
}
