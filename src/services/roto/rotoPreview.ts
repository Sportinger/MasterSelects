import type { RotoSession } from './RotoSession';
import type { RotoPoint } from './rotoTypes';
import type { RotoEdges } from './rotoEdges';

export interface RotoPreviewState {
  clipId: string;
  compositionId: string | null;
  session: RotoSession;
  busy: boolean;
  label: 0 | 1;
  points: RotoPoint[];
  pointTime?: number;
  edges: RotoEdges;
  onPoint: (point: RotoPoint, sourceTime: number) => void;
}
/** Runtime-only bridge between the Roto inspector and the main Preview. */
class RotoPreviewRuntime {
  private state: RotoPreviewState | null = null;
  private owner?: object;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  show(owner: object, state: RotoPreviewState) { this.owner = owner; this.state = state; this.listeners.forEach(listener => listener()); }
  clear(owner: object) {
    if (this.owner !== owner) return;
    this.owner = undefined; this.state = null; this.listeners.forEach(listener => listener());
  }
}
export const rotoPreview: RotoPreviewRuntime = import.meta.hot?.data?.rotoPreview ?? new RotoPreviewRuntime();
if (import.meta.hot) import.meta.hot.dispose(data => { data.rotoPreview = rotoPreview; });
