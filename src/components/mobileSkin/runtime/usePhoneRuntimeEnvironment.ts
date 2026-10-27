// Page-level editor environment for the phone skin: the subset of App.tsx wiring that is not
// desktop-shell behaviour (no dock sync, clip-panel sync or desktop touch gestures).

import { useEffect } from 'react';
import { useBackNavigationGuard } from '../../../hooks/useBackNavigationGuard';
import { useLiveInputFeedbackCoordinator } from '../../../hooks/useLiveInputFeedbackCoordinator';
import { useMIDIRuntime } from '../../../hooks/useMIDIRuntime';
import { usePageZoom } from '../../../hooks/usePageZoom';
import { usePointerFocusHandoff } from '../../../hooks/usePointerFocusHandoff';
import { useTheme } from '../../../hooks/useTheme';
import { audioRoutingManager } from '../../../services/audioRoutingManager';
import { useUiSettingsStore } from '../../../stores/uiSettingsStore';

export function usePhoneRuntimeEnvironment(): void {
  // Theme tokens on the document root (the phone CSS still forces its dark surface).
  useTheme();
  // Browser back/swipe must not leave the open project.
  useBackNavigationGuard();
  // Pinch belongs to the phone timeline, not to page zoom.
  usePageZoom();
  // Release stale control focus after a tap moves to another surface.
  usePointerFocusHandoff();
  useMIDIRuntime();
  // Keep composition-feedback streams aligned with mounted preview canvases.
  useLiveInputFeedbackCoordinator();

  const audioOutputDeviceId = useUiSettingsStore((s) => s.audioOutputDeviceId);
  const audioLatencyHint = useUiSettingsStore((s) => s.audioLatencyHint);

  useEffect(() => {
    audioRoutingManager.setLatencyHint(audioLatencyHint);
    void audioRoutingManager.setOutputDevice(audioOutputDeviceId);
  }, [audioOutputDeviceId, audioLatencyHint]);

  // Long-press on a phone opens the browser's context menu / text callout; the skin owns long-press.
  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
    };
    document.addEventListener('contextmenu', preventBrowserContextMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', preventBrowserContextMenu, { capture: true });
    };
  }, []);
}
