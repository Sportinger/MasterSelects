import { useEffect, useRef } from 'react';
import {
  useNodeWorkspaceNavigation,
  type NodeWorkspaceViewRequest,
} from '../../../services/nodeGraph/nodeWorkspaceNavigation';

/**
 * Applies cross-panel "open this clip in view X" requests exactly once, including a
 * request made just before the workspace panel was mounted.
 */
export function useNodeWorkspaceViewRequests(onRequest: (request: NodeWorkspaceViewRequest) => void, panelId?: string, pinnedClipId?: string | null): void {
  const request = useNodeWorkspaceNavigation((state) => state.request);
  const handledNonce = useNodeWorkspaceNavigation((state) => state.handledNonce);
  const markHandled = useNodeWorkspaceNavigation((state) => state.markHandled);
  const handlerRef = useRef(onRequest);

  useEffect(() => {
    handlerRef.current = onRequest;
  }, [onRequest]);

  useEffect(() => {
    if (!request || request.nonce <= handledNonce) return;
    if (request.panelId ? request.panelId !== panelId : pinnedClipId && pinnedClipId !== request.clipId) return;
    if (!markHandled(request.nonce)) return;
    handlerRef.current(request);
  }, [handledNonce, markHandled, request, panelId, pinnedClipId]);
}
