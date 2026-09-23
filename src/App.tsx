// WebVJ Mixer - Main Application

import { useState, useCallback, useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react';
import { flushSync } from 'react-dom';
import { Toolbar } from './components/common/Toolbar';
import { WorkspaceBar } from './components/common/WorkspaceBar';
import { DockContainer } from './components/dock';
import { useOverLayoutSync } from './components/dock/useOverLayoutSync';
import { TouchGooLayer } from './components/common/touchGoo/TouchGooLayer';
import { IndexedDBErrorDialog } from './components/common/IndexedDBErrorDialog';
import { LinuxVulkanWarning } from './components/common/LinuxVulkanWarning';
import { ProjectLoadProgressOverlay } from './components/common/ProjectLoadProgressOverlay';
import { HistoryActionToast } from './components/common/HistoryActionToast';
import { CameraSolveJobOverlay } from './components/common/CameraSolveJobOverlay';
import { ShortcutDisplayOverlay } from './components/common/ShortcutDisplayOverlay';
import { MuscriptorDialogHost } from './components/common/MuscriptorDialogHost';
import { SourceFitDialogHost } from './components/common/SourceFitDialog';
import { ClippyChatOverlay } from './components/common/clippyChat/ClippyChatOverlay';
import { GuidedActionOverlay } from './components/guidedActions/GuidedActionOverlay';
import { FlashBoardRuntimeHost } from './components/panels/flashboard/FlashBoardRuntimeHost';
import { EditorPlaybackRuntimeHost } from './components/common/EditorPlaybackRuntimeHost';
import { ColorWorkspaceTopBar } from './components/panels/color-workspace/ColorWorkspaceTopBar';
import { TutorialOverlay } from './components/common/TutorialOverlay';
import { TutorialCampaignDialog } from './components/common/TutorialCampaignDialog';
import { InteractiveTutorialOverlay } from './components/common/tutorial/InteractiveTutorialOverlay';
import { TutorialSetupOverlay } from './components/common/tutorial/TutorialSetupOverlay';
import {
  getNextInteractiveCampaign,
  INTERACTIVE_CAMPAIGNS,
  isInteractiveCampaignId,
  STARTUP_GUIDED_TUTORIAL_ID,
} from './components/common/tutorial/interactiveCampaigns';
import { getCampaignById } from './components/common/tutorialCampaigns';
import type { CampaignStep } from './components/common/tutorialCampaigns';
import { useTheme } from './hooks/useTheme';
import { useGlobalSelectWheel } from './hooks/useGlobalSelectWheel';
import { useBackNavigationGuard } from './hooks/useBackNavigationGuard';
import { usePageZoom } from './hooks/usePageZoom';
import { useGlobalHistory } from './hooks/useGlobalHistory';
import { useClipPanelSync } from './hooks/useClipPanelSync';
import { useMIDIRuntime } from './hooks/useMIDIRuntime';
import { useLiveInputFeedbackCoordinator } from './hooks/useLiveInputFeedbackCoordinator';
import { usePointerFocusHandoff } from './hooks/usePointerFocusHandoff';
import { useTrackingAssetActions } from './components/panels/properties/surfaceTracking/useTrackingAssetActions';
import {
  isSyntheticTouchContextMenuEvent,
  useEditorTouchGestures,
} from './hooks/useEditorTouchGestures';
import { useSettingsStore } from './stores/settingsStore';
import { useUiSettingsStore } from './stores/uiSettingsStore';
import { useFlashBoardStore } from './stores/flashboardStore';
import {
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  START_CHROME_EXIT_DELAY_MS,
  START_CHROME_TRANSITION_DURATION_MS,
  START_CHROME_TRANSITION_EVENT,
  START_LAYOUT_REVEAL_DURATION_MS,
  useDockStore,
} from './stores/dockStore';
import {
  resolveInitialDockLayoutId,
  type EditorEntryExperience,
} from './routing/entryDockLayout';
import { installEditorEntryHistoryLayoutSync } from './routing/editorEntryHistory';
import { nodeContainsPanelType } from './stores/dockStore/layoutTree';
import { projectDB } from './services/projectDB';
import { projectFileService } from './services/projectFileService';
import { EditorProjectSelectionOverlay } from './components/common/EditorProjectSelectionOverlay';
import { shouldShowEditorProjectSelection } from './routing/editorProjectSelectionState';
import { audioRoutingManager } from './services/audioRoutingManager';
import './styles/app-shell.css';
import './styles/medium-experience.css';
import './styles/shared-controls.css';

// Dev test pages - lazy loaded to avoid bloating main bundle
// Access via ?test=parallel-decode or ?test=flex-eq
const ParallelDecodeTest = lazy(() =>
  import('./test/ParallelDecodeTest').then(m => ({ default: m.ParallelDecodeTest }))
);
const FlexEqVisualQa = lazy(() =>
  import('./test/FlexEqVisualQa').then(m => ({ default: m.FlexEqVisualQa }))
);
const KeyframeCurveVisualQa = lazy(() =>
  import('./test/KeyframeCurveVisualQa').then(m => ({ default: m.KeyframeCurveVisualQa }))
);

interface AppProps {
  initialExperience?: EditorEntryExperience;
}

function App({ initialExperience = 'editor' }: AppProps) {
  // Check for test mode via URL param
  const urlParams = new URLSearchParams(window.location.search);
  const testMode = urlParams.get('test');

  // === ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS ===
  useTrackingAssetActions();

  const loadSavedLayout = useDockStore((s) => s.loadSavedLayout);
  const isStartLayout = useDockStore((s) => (
    s.activeSavedLayoutId === FACTORY_START_LAYOUT_ID
    || nodeContainsPanelType(s.layout.root, 'start')
  ));
  const [toolbarTransition, setToolbarTransition] = useState<'entering' | 'exiting' | null>(null);
  const [showStartTransitionBackground, setShowStartTransitionBackground] = useState(false);
  const toolbarChromeState = toolbarTransition ?? (isStartLayout ? 'hidden' : 'visible');

  useLayoutEffect(() => {
    const initialLayoutId = resolveInitialDockLayoutId(initialExperience);
    if (!initialLayoutId) return;

    loadSavedLayout(initialLayoutId, {
      transitionDurationMs: 0,
    });
  }, [initialExperience, loadSavedLayout]);

  useEffect(() => {
    return installEditorEntryHistoryLayoutSync(loadSavedLayout);
  }, [loadSavedLayout]);

  useEffect(() => {
    let timeoutId: number | null = null;
    let backgroundTimeoutId: number | null = null;

    const handleStartChromeTransition = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      if (event.detail?.durationMs <= 0) return;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

      const nextTransition = event.detail?.direction === 'to-start'
        ? 'exiting'
        : event.detail?.direction === 'from-start'
          ? 'entering'
          : null;
      if (!nextTransition) return;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (backgroundTimeoutId !== null) {
        window.clearTimeout(backgroundTimeoutId);
        backgroundTimeoutId = null;
      }
      flushSync(() => {
        setToolbarTransition(nextTransition);
        setShowStartTransitionBackground(nextTransition === 'entering');
      });
      if (nextTransition === 'entering') {
        backgroundTimeoutId = window.setTimeout(() => {
          setShowStartTransitionBackground(false);
          backgroundTimeoutId = null;
        }, event.detail.durationMs);
      }
      timeoutId = window.setTimeout(() => {
        setToolbarTransition(null);
        timeoutId = null;
      }, (
        START_CHROME_TRANSITION_DURATION_MS
        + (nextTransition === 'exiting' ? START_CHROME_EXIT_DELAY_MS : 0)
      ));
    };

    window.addEventListener(START_CHROME_TRANSITION_EVENT, handleStartChromeTransition);
    return () => {
      window.removeEventListener(START_CHROME_TRANSITION_EVENT, handleStartChromeTransition);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (backgroundTimeoutId !== null) {
        window.clearTimeout(backgroundTimeoutId);
      }
    };
  }, []);

  // Apply theme to document root
  useTheme();

  // Scroll the mouse wheel over any native <select> to change its value instantly (#174)
  useGlobalSelectWheel();

  // Trap browser back/swipe so it never leaves the app (#200)
  useBackNavigationGuard();

  // Page zoom is disabled; pinch is reserved for editor-owned gestures.
  usePageZoom();

  // Release stale control focus when pointer interaction moves back to an editor surface.
  usePointerFocusHandoff();

  // Long-press is the touch equivalent of the editor's right-click menus.
  useEditorTouchGestures();

  // Initialize global undo/redo system
  const { historyNotice, clearHistoryNotice } = useGlobalHistory();

  // Auto-switch panels based on clip selection
  useClipPanelSync();

  // Browser MIDI runtime
  useMIDIRuntime();

  // Keep composition-feedback streams aligned with mounted preview canvases.
  useLiveInputFeedbackCoordinator();

  // Keep Medium/Mobile above the selected editing workspace and align the two
  // Mobile dock trees with the active composition aspect ratio. The Chat start
  // surface is separate and must not be replaced while used as the landing preview.
  useOverLayoutSync(initialExperience !== 'chat');

  const audioOutputDeviceId = useUiSettingsStore((s) => s.audioOutputDeviceId);
  const audioLatencyHint = useUiSettingsStore((s) => s.audioLatencyHint);

  useEffect(() => {
    audioRoutingManager.setLatencyHint(audioLatencyHint);
    void audioRoutingManager.setOutputDevice(audioOutputDeviceId);
  }, [audioOutputDeviceId, audioLatencyHint]);

  useEffect(() => {
    const preventBrowserContextMenu = (event: MouseEvent) => {
      if (isSyntheticTouchContextMenuEvent(event)) return;
      event.preventDefault();
    };

    document.addEventListener('contextmenu', preventBrowserContextMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', preventBrowserContextMenu, { capture: true });
    };
  }, []);

  // Check project state in IndexedDB (the only allowed browser storage).
  const [isChecking, setIsChecking] = useState(true);
  const [isProjectOpen, setIsProjectOpen] = useState(() => projectFileService.isProjectOpen());
  const [isProjectPermissionPending, setIsProjectPermissionPending] = useState(() => (
    projectFileService.needsPermission()
  ));
  const isColorLayout = useDockStore((s) => s.activeSavedLayoutId === FACTORY_COLOR_LAYOUT_ID);
  const isMediumOverLayout = useDockStore((s) => (
    s.mediumLayoutOverride === true
    || (
      s.mediumLayoutOverride === null
      && s.activeSavedLayoutId === FACTORY_MEDIUM_EDIT_LAYOUT_ID
    )
  ));
  const [isProjectBootPending, setIsProjectBootPending] = useState(() => (
    initialExperience !== 'chat'
  ));
  const [startupOverlaysReady, setStartupOverlaysReady] = useState(() => !isStartLayout);

  const handleProjectBootResolved = useCallback((projectOpen: boolean) => {
    if (initialExperience === 'medium') {
      const mediumLayoutId = resolveInitialDockLayoutId(initialExperience);
      if (mediumLayoutId) {
        loadSavedLayout(mediumLayoutId, { transitionDurationMs: 0 });
      }
      const flashBoardState = useFlashBoardStore.getState();
      const primaryChat = flashBoardState.aiWorkspaces.find(
        (workspace) => workspace.kind === 'chat',
      );
      if (primaryChat) {
        flashBoardState.activateAIWorkspace(primaryChat.id);
      } else {
        flashBoardState.createAIWorkspace({ kind: 'chat', title: 'Chat' });
      }
    }
    setIsProjectOpen(projectOpen);
    setIsProjectPermissionPending(projectFileService.needsPermission());
    setIsProjectBootPending(false);
  }, [initialExperience, loadSavedLayout]);

  useEffect(() => {
    if (isStartLayout) {
      const frameId = window.requestAnimationFrame(() => {
        setStartupOverlaysReady(false);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const timeoutId = window.setTimeout(() => {
      setStartupOverlaysReady(true);
    }, reduceMotion ? 0 : START_LAYOUT_REVEAL_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [isStartLayout]);

  // Tutorial completion state
  const hasSeenTutorial = useSettingsStore((s) => s.hasSeenTutorial);
  const setHasSeenTutorial = useSettingsStore((s) => s.setHasSeenTutorial);
  const setHasSeenTutorialPart2 = useSettingsStore((s) => s.setHasSeenTutorialPart2);

  // Campaign tutorial state
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [showTutorialSetup, setShowTutorialSetup] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<{ id: string; title: string; steps: CampaignStep[]; interactive?: boolean } | null>(null);
  const startupTutorialScheduledRef = useRef(false);
  const completeTutorial = useSettingsStore((s) => s.completeTutorial);

  // IndexedDB error dialog state
  const [showIndexedDBError, setShowIndexedDBError] = useState(false);

  // Load the optional non-AI YouTube integration credential on mount.
  const loadIntegrationCredentials = useSettingsStore((s) => s.loadIntegrationCredentials);
  useEffect(() => {
    void loadIntegrationCredentials();
  }, [loadIntegrationCredentials]);

  // Check for stored project on mount, then poll for changes
  // This handles the case where Toolbar's restore fails and clears handles
  useEffect(() => {
    const checkProject = async () => {
      // Check if IndexedDB has failed to initialize
      if (projectDB.hasInitFailed()) {
        setShowIndexedDBError(true);
        setIsChecking(false);
        return;
      }

      try {
        await projectDB.hasLastProject();
        const isOpen = projectFileService.isProjectOpen();
        setIsProjectOpen(isOpen);
        setIsProjectPermissionPending(projectFileService.needsPermission());
      } catch {
        // If hasLastProject fails, IndexedDB is corrupted
        if (projectDB.hasInitFailed()) {
          setShowIndexedDBError(true);
        }
      }
      setIsChecking(false);
    };

    checkProject();

    // Poll for changes (handles cleared after failed restore)
    // Using 2000ms interval to reduce CPU usage - project state changes are rare
    const interval = setInterval(async () => {
      // Check if IndexedDB has failed (could happen after initial load)
      if (projectDB.hasInitFailed()) {
        setShowIndexedDBError(true);
        return;
      }

      try {
        await projectDB.hasLastProject();
        const isOpen = projectFileService.isProjectOpen();
        setIsProjectOpen(isOpen);
      } catch {
        if (projectDB.hasInitFailed()) {
          setShowIndexedDBError(true);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const activateTutorialCampaign = useCallback((campaignId: string) => {
    const campaign = getCampaignById(campaignId);
    if (!campaign) return false;
    setShowCampaignDialog(false);
    setActiveCampaign({
      id: campaign.id,
      title: campaign.title,
      steps: campaign.steps,
      interactive: campaign.interactive,
    });
    return true;
  }, []);

  const startTutorialSequence = useCallback(() => {
    setShowCampaignDialog(false);
    setActiveCampaign(null);
    setShowTutorialSetup(true);
  }, []);

  useEffect(() => {
    if (startupTutorialScheduledRef.current || hasSeenTutorial) return;
    if (initialExperience !== 'editor') return;
    if (!startupOverlaysReady || isStartLayout || isChecking) return;
    if (
      isProjectBootPending
      || isProjectPermissionPending
      || shouldShowEditorProjectSelection(
        initialExperience,
        isProjectOpen,
        isProjectPermissionPending,
      )
    ) return;

    startupTutorialScheduledRef.current = true;
    const timeoutId = window.setTimeout(startTutorialSequence, 200);
    return () => window.clearTimeout(timeoutId);
  }, [
    hasSeenTutorial,
    initialExperience,
    isChecking,
    isProjectBootPending,
    isProjectOpen,
    isProjectPermissionPending,
    isStartLayout,
    startTutorialSequence,
    startupOverlaysReady,
  ]);

  const handleTutorialSetupComplete = useCallback(() => {
    setShowTutorialSetup(false);
    activateTutorialCampaign(STARTUP_GUIDED_TUTORIAL_ID);
  }, [activateTutorialCampaign]);

  const handleTutorialSetupCancel = useCallback(() => {
    setShowTutorialSetup(false);
    setHasSeenTutorial(true);
    setHasSeenTutorialPart2(true);
  }, [setHasSeenTutorial, setHasSeenTutorialPart2]);

  // Campaign tutorial handlers
  const handleStartCampaign = useCallback((campaignId: string) => {
    activateTutorialCampaign(campaignId);
  }, [activateTutorialCampaign]);

  const handleCampaignClose = useCallback(() => {
    if (activeCampaign) {
      completeTutorial(activeCampaign.id);
      if (activeCampaign.interactive) {
        const nextCampaign = getNextInteractiveCampaign(activeCampaign.id);
        if (nextCampaign) {
          activateTutorialCampaign(nextCampaign.id);
          return;
        }
      }
      if (isInteractiveCampaignId(activeCampaign.id)) {
        setHasSeenTutorial(true);
        setHasSeenTutorialPart2(true);
      }
    }
    setActiveCampaign(null);
  }, [
    activateTutorialCampaign,
    activeCampaign,
    completeTutorial,
    setHasSeenTutorial,
    setHasSeenTutorialPart2,
  ]);

  const handleCampaignSkip = useCallback(() => {
    if (activeCampaign && isInteractiveCampaignId(activeCampaign.id)) {
      setHasSeenTutorial(true);
      setHasSeenTutorialPart2(true);
    }
    setActiveCampaign(null);
  }, [activeCampaign, setHasSeenTutorial, setHasSeenTutorialPart2]);

  const handleCampaignCancel = useCallback(() => {
    if (activeCampaign && isInteractiveCampaignId(activeCampaign.id)) {
      setHasSeenTutorial(true);
      setHasSeenTutorialPart2(true);
    }
    setActiveCampaign(null);
  }, [activeCampaign, setHasSeenTutorial, setHasSeenTutorialPart2]);

  // Listen for manual tutorial trigger from Info menu
  useEffect(() => {
    const handleStartTutorial = () => {
      startTutorialSequence();
    };
    const handleOpenCampaignDialog = () => {
      setShowCampaignDialog(true);
    };
    window.addEventListener('start-tutorial', handleStartTutorial);
    window.addEventListener('open-tutorial-campaigns', handleOpenCampaignDialog);
    return () => {
      window.removeEventListener('start-tutorial', handleStartTutorial);
      window.removeEventListener('open-tutorial-campaigns', handleOpenCampaignDialog);
    };
  }, [startTutorialSequence]);

  const handleIndexedDBErrorClose = useCallback(() => {
    setShowIndexedDBError(false);
  }, []);

  // === EARLY RETURNS AFTER ALL HOOKS ===

  // Test mode - wrapped in Suspense for lazy-loaded component
  if (testMode === 'parallel-decode') {
    return (
      <Suspense fallback={<div style={{ padding: 20 }}>Loading test...</div>}>
        <ParallelDecodeTest />
      </Suspense>
    );
  }

  if (testMode === 'flex-eq') {
    return (
      <Suspense fallback={<div style={{ padding: 20 }}>Loading test...</div>}>
        <FlexEqVisualQa />
      </Suspense>
    );
  }

  if (testMode === 'keyframe-curve') {
    return (
      <Suspense fallback={<div style={{ padding: 20 }}>Loading test...</div>}>
        <KeyframeCurveVisualQa />
      </Suspense>
    );
  }

  const activeInteractiveCampaign = activeCampaign?.interactive
    ? INTERACTIVE_CAMPAIGNS.find((campaign) => campaign.id === activeCampaign.id) ?? null
    : null;

  return (
    <div
      className={[
        'app',
        isStartLayout ? 'app--start-layout' : 'app--editor-layout',
        initialExperience === 'chat' ? 'app--chat-experience' : null,
        !isStartLayout && isMediumOverLayout ? 'app--medium-experience' : null,
        `app--toolbar-${toolbarChromeState}`,
      ].filter(Boolean).join(' ')}
    >
      {!isStartLayout && <LinuxVulkanWarning />}
      {showStartTransitionBackground && (
        <div className="app-start-transition-background" aria-hidden="true" />
      )}
      <Toolbar
        onProjectBootResolved={handleProjectBootResolved}
      />
      <FlashBoardRuntimeHost />
      {!isStartLayout && <EditorPlaybackRuntimeHost />}
      {isColorLayout && <ColorWorkspaceTopBar />}
      <DockContainer detachedWindowsReady={!isProjectBootPending} />
      <WorkspaceBar />
      <TouchGooLayer />
      {!isProjectBootPending && shouldShowEditorProjectSelection(
        initialExperience,
        isProjectOpen,
        isProjectPermissionPending,
      ) && (
        <EditorProjectSelectionOverlay
          onProjectSelected={() => setIsProjectOpen(true)}
        />
      )}
      {!isStartLayout && (
        <>
          <GuidedActionOverlay />
          {!isProjectBootPending && isProjectOpen && !isProjectPermissionPending
            && !showTutorialSetup && !activeCampaign && !activeInteractiveCampaign
            && <ClippyChatOverlay />}
          <ShortcutDisplayOverlay />
          <ProjectLoadProgressOverlay />
          <CameraSolveJobOverlay />
          <MuscriptorDialogHost />
          <SourceFitDialogHost />
          <HistoryActionToast notice={historyNotice} onDone={clearHistoryNotice} />
          {showIndexedDBError && (
            <IndexedDBErrorDialog onClose={handleIndexedDBErrorClose} />
          )}
          {showCampaignDialog && (
            <TutorialCampaignDialog
              onClose={() => setShowCampaignDialog(false)}
              onStartCampaign={handleStartCampaign}
            />
          )}
          {showTutorialSetup && (
            <TutorialSetupOverlay
              onCancel={handleTutorialSetupCancel}
              onComplete={handleTutorialSetupComplete}
            />
          )}
          {activeInteractiveCampaign ? (
            <InteractiveTutorialOverlay
              key={`interactive-${activeInteractiveCampaign.id}`}
              campaign={activeInteractiveCampaign}
              onCancel={handleCampaignCancel}
              onClose={handleCampaignClose}
              onSkip={handleCampaignSkip}
            />
          ) : activeCampaign && !activeCampaign.interactive ? (
            <TutorialOverlay
              key={`campaign-${activeCampaign.id}`}
              onClose={handleCampaignClose}
              onSkip={handleCampaignSkip}
              campaignSteps={activeCampaign.steps}
              campaignTitle={activeCampaign.title}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export default App;
