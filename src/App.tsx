// WebVJ Mixer - Main Application

// Changelog visibility controlled by Vite define:
// npm run dev          → hidden (default)
// npm run dev:changelog → shown
// npm run build        → always shown
declare const __SHOW_CHANGELOG__: boolean;
const SHOW_CHANGELOG = typeof __SHOW_CHANGELOG__ !== 'undefined' ? __SHOW_CHANGELOG__ : true;

import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Toolbar } from './components';
import { DockContainer } from './components/dock';
import { AccountDialog } from './components/common/AccountDialog';
import { AuthDialog } from './components/common/AuthDialog';
import { WelcomeOverlay } from './components/common/WelcomeOverlay';
import { WhatsNewDialog } from './components/common/WhatsNewDialog';
import { SplashScreen } from './components/common/SplashScreen';
import { IndexedDBErrorDialog } from './components/common/IndexedDBErrorDialog';
import { LinuxVulkanWarning } from './components/common/LinuxVulkanWarning';
import { PricingDialog } from './components/common/PricingDialog';
import { TutorialOverlay } from './components/common/TutorialOverlay';
import { TutorialCampaignDialog } from './components/common/TutorialCampaignDialog';
import { getCampaignById } from './components/common/tutorialCampaigns';
import type { CampaignStep } from './components/common/tutorialCampaigns';
import { MobileApp } from './components/mobile';
import { useTheme } from './hooks/useTheme';
import { useGlobalHistory } from './hooks/useGlobalHistory';
import { useClipPanelSync } from './hooks/useClipPanelSync';
import { useIsMobile, useForceMobile } from './hooks/useIsMobile';
import { useAccountStore } from './stores/accountStore';
import { useSettingsStore } from './stores/settingsStore';
import { projectDB } from './services/projectDB';
import { projectFileService } from './services/projectFileService';
import { APP_VERSION, shouldAutoShowChangelog } from './version';
import './App.css';

// Dev test pages - lazy loaded to avoid bloating main bundle
// Access via ?test=parallel-decode
const ParallelDecodeTest = lazy(() =>
  import('./test/ParallelDecodeTest').then(m => ({ default: m.ParallelDecodeTest }))
);

function App() {
  // Check for test mode via URL param
  const urlParams = new URLSearchParams(window.location.search);
  const testMode = urlParams.get('test');

  // === ALL HOOKS MUST BE CALLED BEFORE ANY EARLY RETURNS ===

  // Mobile detection
  const isMobile = useIsMobile();
  const forceMobile = useForceMobile();
  const forceDesktopMode = useSettingsStore((s) => s.forceDesktopMode);

  // Apply theme to document root
  useTheme();

  // Initialize global undo/redo system
  useGlobalHistory();

  // Auto-switch panels based on clip selection
  useClipPanelSync();

  // Check if there's a stored project in IndexedDB (the only allowed browser storage)
  const [isChecking, setIsChecking] = useState(true);
  const [hasStoredProject, setHasStoredProject] = useState(false);
  const [manuallyDismissed, setManuallyDismissed] = useState(false);

  // Splash screen state - shown on startup with video + notices
  const [showSplash, setShowSplash] = useState(false);
  // Changelog dialog state - full changelog with calendar + all changes
  const [showChangelog, setShowChangelog] = useState(false);
  const showChangelogOnStartup = useSettingsStore((s) => s.showChangelogOnStartup);
  const lastSeenChangelogVersion = useSettingsStore((s) => s.lastSeenChangelogVersion);

  // Tutorial state (legacy part 1/2)
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialPart, setTutorialPart] = useState<1 | 2>(1);
  const hasSeenTutorial = useSettingsStore((s) => s.hasSeenTutorial);
  const setHasSeenTutorial = useSettingsStore((s) => s.setHasSeenTutorial);
  const hasSeenTutorialPart2 = useSettingsStore((s) => s.hasSeenTutorialPart2);
  const setHasSeenTutorialPart2 = useSettingsStore((s) => s.setHasSeenTutorialPart2);

  // Campaign tutorial state
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<{ id: string; title: string; steps: CampaignStep[] } | null>(null);
  const completeTutorial = useSettingsStore((s) => s.completeTutorial);

  // IndexedDB error dialog state
  const [showIndexedDBError, setShowIndexedDBError] = useState(false);

  // Load API keys from encrypted storage on mount
  const loadApiKeys = useSettingsStore((s) => s.loadApiKeys);
  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const accountDialog = useAccountStore((s) => s.dialog);
  const closeAccountDialog = useAccountStore((s) => s.closeDialog);
  const isAccountInitialized = useAccountStore((s) => s.isInitialized);
  const loadAccountState = useAccountStore((s) => s.loadAccountState);
  const openAccountDialog = useAccountStore((s) => s.openAccountDialog);
  useEffect(() => {
    void loadAccountState();
  }, [loadAccountState]);

  useEffect(() => {
    if (!isAccountInitialized) {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const authStatus = currentUrl.searchParams.get('auth');
    const billingStatus = currentUrl.searchParams.get('billing');

    if (authStatus !== 'success' && billingStatus !== 'success') {
      return;
    }

    const finalize = async () => {
      await loadAccountState();
      openAccountDialog();

      currentUrl.searchParams.delete('auth');
      currentUrl.searchParams.delete('billing');
      currentUrl.searchParams.delete('plan');
      window.history.replaceState({}, document.title, `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    };

    void finalize();
  }, [isAccountInitialized, loadAccountState, openAccountDialog]);

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
        // Check both: IndexedDB handle exists AND project is actually open
        const hasHandle = await projectDB.hasLastProject();
        const isOpen = projectFileService.isProjectOpen();
        setHasStoredProject(hasHandle || isOpen);
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
        const hasHandle = await projectDB.hasLastProject();
        const isOpen = projectFileService.isProjectOpen();
        setHasStoredProject(hasHandle || isOpen);
      } catch {
        if (projectDB.hasInitFailed()) {
          setShowIndexedDBError(true);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Show welcome if no stored project and not manually dismissed this session
  // Don't show while checking to avoid flash
  const showWelcome = !isChecking && !hasStoredProject && !manuallyDismissed;
  const shouldShowChangelogOnStartup = SHOW_CHANGELOG
    && shouldAutoShowChangelog(showChangelogOnStartup, lastSeenChangelogVersion, APP_VERSION);

  // Show Splash screen after initial check (when no welcome overlay)
  // This effect intentionally sets state based on derived conditions
  useEffect(() => {
    if (!shouldShowChangelogOnStartup) return;
    if (isChecking) return;

    // If welcome is showing, don't show splash yet
    if (showWelcome) return;

    // Show splash screen - this is intentional state sync, not a cascading render
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowSplash(true);
  }, [isChecking, showWelcome, shouldShowChangelogOnStartup]);

  const handleWelcomeComplete = useCallback(() => {
    setManuallyDismissed(true);
    setHasStoredProject(true); // Project was just created
    // After welcome, show splash screen with small delay for animation
    if (shouldShowChangelogOnStartup) {
      setTimeout(() => setShowSplash(true), 300);
    } else if (!hasSeenTutorial) {
      // No splash → start tutorial directly
      setTimeout(() => setShowTutorial(true), 200);
    }
  }, [hasSeenTutorial, shouldShowChangelogOnStartup]);

  const handleSplashClose = useCallback(() => {
    setShowSplash(false);
    if (!hasSeenTutorial) {
      setTimeout(() => setShowTutorial(true), 200);
    }
  }, [hasSeenTutorial]);

  const handleSplashOpenChangelog = useCallback(() => {
    setShowSplash(false);
    setShowChangelog(true);
  }, []);

  const handleChangelogClose = useCallback(() => {
    setShowChangelog(false);
    if (!hasSeenTutorial) {
      setTimeout(() => setShowTutorial(true), 200);
    }
  }, [hasSeenTutorial]);

  const handleTutorialClose = useCallback(() => {
    if (tutorialPart === 1 && !hasSeenTutorialPart2) {
      // Part 1 finished, auto-start Part 2
      setTutorialPart(2);
      setHasSeenTutorial(true);
    } else if (tutorialPart === 2) {
      // Part 2 finished
      setShowTutorial(false);
      setHasSeenTutorial(true);
      setHasSeenTutorialPart2(true);
    } else {
      // Part 1 re-triggered manually (Part 2 already seen)
      setShowTutorial(false);
    }
  }, [tutorialPart, hasSeenTutorialPart2, setHasSeenTutorial, setHasSeenTutorialPart2]);

  const handleTutorialSkip = useCallback(() => {
    setShowTutorial(false);
    setHasSeenTutorial(true);
    setHasSeenTutorialPart2(true);
  }, [setHasSeenTutorial, setHasSeenTutorialPart2]);

  // Campaign tutorial handlers
  const handleStartCampaign = useCallback((campaignId: string) => {
    const campaign = getCampaignById(campaignId);
    if (!campaign) return;
    setShowCampaignDialog(false);
    setActiveCampaign({ id: campaign.id, title: campaign.title, steps: campaign.steps });
  }, []);

  const handleCampaignClose = useCallback(() => {
    if (activeCampaign) {
      completeTutorial(activeCampaign.id);
    }
    setActiveCampaign(null);
  }, [activeCampaign, completeTutorial]);

  const handleCampaignSkip = useCallback(() => {
    setActiveCampaign(null);
  }, []);

  // Listen for manual tutorial trigger from Info menu
  useEffect(() => {
    const handleStartTutorial = () => {
      setTutorialPart(1);
      setShowTutorial(true);
    };
    const handleStartTimelineTutorial = () => {
      setTutorialPart(2);
      setShowTutorial(true);
    };
    const handleOpenCampaignDialog = () => {
      setShowCampaignDialog(true);
    };
    const handleOpenWelcomeScreen = () => {
      setTutorialPart(1);
      setShowTutorial(true);
    };
    window.addEventListener('start-tutorial', handleStartTutorial);
    window.addEventListener('start-timeline-tutorial', handleStartTimelineTutorial);
    window.addEventListener('open-tutorial-campaigns', handleOpenCampaignDialog);
    window.addEventListener('open-welcome-screen', handleOpenWelcomeScreen);
    return () => {
      window.removeEventListener('start-tutorial', handleStartTutorial);
      window.removeEventListener('start-timeline-tutorial', handleStartTimelineTutorial);
      window.removeEventListener('open-tutorial-campaigns', handleOpenCampaignDialog);
      window.removeEventListener('open-welcome-screen', handleOpenWelcomeScreen);
    };
  }, []);

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

  // Show mobile UI unless user explicitly requested desktop mode
  const showMobileUI = (isMobile || forceMobile) && !forceDesktopMode;
  if (showMobileUI) {
    return <MobileApp />;
  }

  return (
    <div className="app">
      <LinuxVulkanWarning />
      <Toolbar onOpenChangelog={() => setShowChangelog(true)} onOpenSplash={() => setShowSplash(true)} />
      <DockContainer />
      {showWelcome && (
        <WelcomeOverlay onComplete={handleWelcomeComplete} noFadeOnClose />
      )}
      {showSplash && (
        <SplashScreen onClose={handleSplashClose} onOpenChangelog={handleSplashOpenChangelog} />
      )}
      {showChangelog && (
        <WhatsNewDialog onClose={handleChangelogClose} />
      )}
      {showIndexedDBError && (
        <IndexedDBErrorDialog onClose={handleIndexedDBErrorClose} />
      )}
      {showTutorial && (
        <TutorialOverlay key={tutorialPart} onClose={handleTutorialClose} onSkip={handleTutorialSkip} part={tutorialPart} />
      )}
      {showCampaignDialog && (
        <TutorialCampaignDialog
          onClose={() => setShowCampaignDialog(false)}
          onStartCampaign={handleStartCampaign}
        />
      )}
      {activeCampaign && (
        <TutorialOverlay
          key={`campaign-${activeCampaign.id}`}
          onClose={handleCampaignClose}
          onSkip={handleCampaignSkip}
          campaignSteps={activeCampaign.steps}
          campaignTitle={activeCampaign.title}
        />
      )}
      {accountDialog === 'auth' && <AuthDialog onClose={closeAccountDialog} />}
      {accountDialog === 'pricing' && <PricingDialog onClose={closeAccountDialog} />}
      {accountDialog === 'account' && <AccountDialog onClose={closeAccountDialog} />}
    </div>
  );
}

export default App;
