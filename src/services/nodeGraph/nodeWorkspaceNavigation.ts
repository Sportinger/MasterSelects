import { create } from 'zustand';
import type { NodeGraphViewTheme } from '../../types/nodeGraph';

/**
 * Cross-panel request to show a clip's graph in a specific Node Workspace
 * view (e.g. Properties "Open Nodes" -> Flock view). The workspace consumes
 * the request by nonce, so repeated clicks re-apply the view.
 */
export interface NodeWorkspaceViewRequest {
  clipId: string;
  theme: NodeGraphViewTheme;
  nonce: number;
  nodeId?: string;
  animation?: boolean;
  panelId?: string;
}

interface NodeWorkspaceNavigationState {
  request: NodeWorkspaceViewRequest | null;
  /** Nonce of the last request a mounted workspace applied (prevents re-applying on remount). */
  handledNonce: number;
  requestView: (clipId: string, theme: NodeGraphViewTheme) => void;
  markHandled: (nonce: number) => boolean;
}

let nonce = 0;

export const useNodeWorkspaceNavigation = create<NodeWorkspaceNavigationState>((set) => ({
  request: null,
  handledNonce: 0,
  requestView: (clipId, theme) => {
    nonce += 1;
    set({ request: { clipId, theme, nonce } });
  },
  markHandled: (handled) => {
    let claimed = false;
    set((state) => {
      if (state.handledNonce >= handled) return state;
      claimed = true;
      return { handledNonce: handled };
    });
    return claimed;
  },
}));

export function requestNodeWorkspaceView(clipId: string, theme: NodeGraphViewTheme, panelId?: string): void {
  nonce += 1;
  useNodeWorkspaceNavigation.setState({ request: { clipId, theme, nonce, ...(panelId ? { panelId } : {}) } });
}

export function requestNodeAnimation(clipId: string, nodeId: string, animation = true): void {
  nonce += 1;
  useNodeWorkspaceNavigation.setState({ request: { clipId, theme: 'general', nodeId, animation, nonce } });
}
