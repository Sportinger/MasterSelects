// A transform-gizmo drag owns an open edit session (a transaction) from its first move until the
// fingers lift. When the handles stop rendering mid-drag (the playhead leaves the clip during
// playback, the selection changes, a sheet opens, fullscreen, handles switched off), pointerup never
// reaches the gizmo. This guard settles such an abandoned gesture so its transaction is never left
// open (an open one blocks project switches and is rolled back silently on the next window blur).

import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';

export type PhoneGizmoAbandonReason = 'clip-left' | 'unmount';

export function usePhoneGizmoAbandonGuard(
  liveClipId: string | null,
  gestureRef: MutableRefObject<{ clipId: string } | null>,
  settle: (reason: PhoneGizmoAbandonReason) => void,
): void {
  const settleRef = useRef(settle);
  useLayoutEffect(() => { settleRef.current = settle; });
  useEffect(() => {
    const gesture = gestureRef.current;
    if (gesture && gesture.clipId !== liveClipId) settleRef.current('clip-left');
  }, [liveClipId, gestureRef]);
  useEffect(() => () => {
    if (gestureRef.current) settleRef.current('unmount');
  }, [gestureRef]);
}
