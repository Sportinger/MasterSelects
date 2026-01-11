// WebVJ Mixer - Main Application

import { useState, useCallback } from 'react';
import { Toolbar } from './components';
import { DockContainer } from './components/dock';
import { WelcomeOverlay } from './components/common/WelcomeOverlay';
import { useGlobalHistory } from './hooks/useGlobalHistory';
import { useClipPanelSync } from './hooks/useClipPanelSync';
import { useSettingsStore } from './stores/settingsStore';
import './App.css';

function App() {
  // Initialize global undo/redo system
  useGlobalHistory();

  // Auto-switch panels based on clip selection
  useClipPanelSync();

  // Check if setup has been completed (persisted in settings store)
  const hasCompletedSetup = useSettingsStore((s) => s.hasCompletedSetup);
  const [manuallyDismissed, setManuallyDismissed] = useState(false);

  // Show welcome if setup not completed and not manually dismissed this session
  const showWelcome = !hasCompletedSetup && !manuallyDismissed;

  const handleWelcomeComplete = useCallback(() => {
    setManuallyDismissed(true);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <DockContainer />
      {showWelcome && (
        <WelcomeOverlay onComplete={handleWelcomeComplete} />
      )}
    </div>
  );
}

export default App;
