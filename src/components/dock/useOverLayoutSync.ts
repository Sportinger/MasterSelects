import { useEffect, useRef } from 'react';

import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  getWorkspaceOverLayout,
  useDockStore,
} from '../../stores/dockStore';
import { cloneDockLayout } from '../../stores/dockStore/layoutPersistence';
import { requestDockLayoutTransition } from '../../stores/dockStore/layoutTransition';
import {
  applySavedTimelineLayout,
  captureTimelineLayout,
} from '../../stores/dockStore/timelineLayoutAdapter';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type {
  BrowserWindowPanel,
  DockLayout,
  SavedDockTimelineLayout,
} from '../../types/dock';
import {
  useAutomaticMobileLayoutEnvironment,
  useDetectedMobileDevice,
} from './mobileDeviceDetection';
import { resolveMobileLayoutForComposition } from './mobileLayoutOrientation';

interface PreviousEditorLayout {
  activeSavedLayoutId: string | null;
  browserWindowPanels: BrowserWindowPanel[];
  layout: DockLayout;
  maxZIndex: number;
  maximizedPanelId: string | null;
  timeline: SavedDockTimelineLayout;
}

function restorePreviousEditorLayout(snapshot: PreviousEditorLayout): void {
  const layout = cloneDockLayout(snapshot.layout);
  requestDockLayoutTransition();
  useDockStore.setState({
    activeSavedLayoutId: snapshot.activeSavedLayoutId,
    browserWindowPanels: snapshot.browserWindowPanels,
    hoveredTabTarget: null,
    layout,
    maxZIndex: snapshot.maxZIndex,
    maximizedPanelId: snapshot.maximizedPanelId,
  });
  applySavedTimelineLayout(snapshot.timeline);
}

/**
 * Keeps the selected Video/Audio/3D/Color/Live layout underneath the global
 * Medium and Mobile presentation modifiers. Only Video has dedicated
 * over-layout trees today, so other selections retain their identity while
 * using that fallback; when both modifiers are active, Mobile supplies the
 * spatial tree and Medium supplies the simplified visual treatment.
 */
export function useOverLayoutSync(enabled = true): void {
  const automaticMobileLayoutEnvironment = useAutomaticMobileLayoutEnvironment();
  const detectedMobileDevice = useDetectedMobileDevice();
  const automaticMobileLayoutEnabled = useSettingsStore(
    (state) => state.automaticMobileLayoutEnabled,
  );
  const enteredManagedOverLayoutRef = useRef(false);
  const previousEditorLayoutRef = useRef<PreviousEditorLayout | null>(null);
  const activeLayoutId = useDockStore((state) => state.activeSavedLayoutId);
  const browserWindowPanels = useDockStore((state) => state.browserWindowPanels);
  const layout = useDockStore((state) => state.layout);
  const loadSavedLayout = useDockStore((state) => state.loadSavedLayout);
  const maxZIndex = useDockStore((state) => state.maxZIndex);
  const maximizedPanelId = useDockStore((state) => state.maximizedPanelId);
  const overLayoutBaseId = useDockStore((state) => state.overLayoutBaseId);
  const mediumLayoutOverride = useDockStore((state) => state.mediumLayoutOverride);
  const mobileLayoutOverride = useDockStore((state) => state.mobileLayoutOverride);
  const setOverLayoutBaseId = useDockStore((state) => state.setOverLayoutBaseId);
  const setMediumLayoutOverride = useDockStore((state) => state.setMediumLayoutOverride);
  const setMobileLayoutOverride = useDockStore((state) => state.setMobileLayoutOverride);
  const compositionSize = useMediaStore((state) => {
    const composition = state.compositions.find(
      (candidate) => candidate.id === state.activeCompositionId,
    );
    return composition ? `${composition.width}:${composition.height}` : '';
  });

  useEffect(() => {
    if (!enabled) {
      enteredManagedOverLayoutRef.current = false;
      previousEditorLayoutRef.current = null;
      return;
    }

    const activeOverLayout = getWorkspaceOverLayout(activeLayoutId);
    const automaticMobileRequested = (
      detectedMobileDevice
      || (automaticMobileLayoutEnabled && automaticMobileLayoutEnvironment)
    );

    // Direct entry and persisted overlay trees start without transient flags.
    // Adopt them explicitly so the modifier survives a sub-layout switch.
    if (
      activeOverLayout === 'medium'
      && mediumLayoutOverride === null
      && !enteredManagedOverLayoutRef.current
    ) {
      setOverLayoutBaseId(FACTORY_VIDEO_EDIT_LAYOUT_ID);
      setMediumLayoutOverride(true);
      return;
    }
    if (
      activeOverLayout === 'mobile'
      && mobileLayoutOverride === null
      && !automaticMobileRequested
      && !enteredManagedOverLayoutRef.current
    ) {
      setOverLayoutBaseId(FACTORY_VIDEO_EDIT_LAYOUT_ID);
      setMobileLayoutOverride(true);
      return;
    }

    const mediumLayoutRequested = mediumLayoutOverride ?? (activeOverLayout === 'medium');
    const mobileLayoutRequested = mobileLayoutOverride ?? automaticMobileRequested;
    const requestedOverLayout = mobileLayoutRequested
      ? 'mobile'
      : mediumLayoutRequested
        ? 'medium'
        : 'desktop';

    if (requestedOverLayout === 'desktop') {
      const previousEditorLayout = previousEditorLayoutRef.current;
      const shouldRestorePreviousLayout = (
        enteredManagedOverLayoutRef.current
        && activeOverLayout !== null
        && previousEditorLayout !== null
      );
      enteredManagedOverLayoutRef.current = false;
      previousEditorLayoutRef.current = null;
      if (overLayoutBaseId !== null) setOverLayoutBaseId(null);

      if (shouldRestorePreviousLayout) {
        restorePreviousEditorLayout(previousEditorLayout);
        return;
      }
      if (activeOverLayout !== null) {
        loadSavedLayout(overLayoutBaseId ?? FACTORY_VIDEO_EDIT_LAYOUT_ID);
      }
      return;
    }

    if (activeLayoutId === FACTORY_START_LAYOUT_ID) return;

    if (activeOverLayout === null) {
      previousEditorLayoutRef.current = {
        activeSavedLayoutId: activeLayoutId,
        browserWindowPanels: [...browserWindowPanels],
        layout: cloneDockLayout(layout),
        maxZIndex,
        maximizedPanelId,
        timeline: captureTimelineLayout(),
      };
      enteredManagedOverLayoutRef.current = true;
      setOverLayoutBaseId(activeLayoutId);
    } else if (overLayoutBaseId === null) {
      setOverLayoutBaseId(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    }

    const [compositionWidth, compositionHeight] = compositionSize
      .split(':')
      .map(Number);
    const targetLayoutId = requestedOverLayout === 'medium'
      ? FACTORY_MEDIUM_EDIT_LAYOUT_ID
      : resolveMobileLayoutForComposition({
          activeLayoutId,
          compositionWidth,
          compositionHeight,
          enterMobileLayout: true,
        });
    if (!targetLayoutId || targetLayoutId === activeLayoutId) return;

    loadSavedLayout(targetLayoutId);
  }, [
    activeLayoutId,
    automaticMobileLayoutEnabled,
    automaticMobileLayoutEnvironment,
    browserWindowPanels,
    compositionSize,
    detectedMobileDevice,
    enabled,
    layout,
    loadSavedLayout,
    maxZIndex,
    maximizedPanelId,
    overLayoutBaseId,
    mediumLayoutOverride,
    mobileLayoutOverride,
    setOverLayoutBaseId,
    setMediumLayoutOverride,
    setMobileLayoutOverride,
  ]);
}
