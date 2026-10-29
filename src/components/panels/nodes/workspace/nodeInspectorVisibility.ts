import { create } from 'zustand';
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware';
import { nodeInspectorStartsOpen } from './nodeInspectorDefault';

/**
 * Whether a Nodes panel shows its inspector sidebar. One value per panel, shared by the composition
 * view and every clip graph inside it, and kept across remounts and reloads. Picking nodes, clips,
 * strip segments or transitions never changes it: the content follows the selection while the
 * sidebar stays as the user left it. Only the handle and explicit commands open it (Catalog,
 * Effect presets, a node's animation badge).
 */
interface NodeInspectorVisibilityState {
  open: Record<string, boolean>;
}

export const useNodeInspectorVisibility = create<NodeInspectorVisibilityState>()(subscribeWithSelector(persist(() => ({ open: {} }), {
  name: 'masterselects.nodeWorkspace.inspectorOpen',
  storage: createJSONStorage(() => localStorage),
})));

/** The phone skin keeps its own value: there the inspector is a drawer over the canvas and starts closed. */
function scopeOf(panelId: string): string {
  return `${nodeInspectorStartsOpen() ? 'desktop' : 'phone'}:${panelId}`;
}

export function setNodeInspectorOpen(panelId: string, open: boolean): void {
  const scope = scopeOf(panelId);
  useNodeInspectorVisibility.setState(state => state.open[scope] === open ? state : { open: { ...state.open, [scope]: open } });
}

export function useNodeInspectorOpen(panelId: string): boolean {
  const stored = useNodeInspectorVisibility(state => state.open[scopeOf(panelId)]);
  return stored ?? nodeInspectorStartsOpen();
}
