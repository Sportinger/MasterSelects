// WebVJ Mixer - Main Application

import { useState, useCallback, useEffect } from 'react';
import { Toolbar } from './components';
import { DockContainer } from './components/dock';
import { WelcomeOverlay } from './components/common/WelcomeOverlay';
import { useGlobalHistory } from './hooks/useGlobalHistory';
import { useClipPanelSync } from './hooks/useClipPanelSync';
import { projectDB } from './services/projectDB';
import './App.css';

function App() {
  // Initialize global undo/redo system
  useGlobalHistory();

  // Auto-switch panels based on clip selection
  useClipPanelSync();

  // Check if there's a stored project in IndexedDB (the only allowed browser storage)
  const [isChecking, setIsChecking] = useState(true);
  const [hasStoredProject, setHasStoredProject] = useState(false);
  const [manuallyDismissed, setManuallyDismissed] = useState(false);

  // Check for stored project on mount
  useEffect(() => {
    projectDB.hasLastProject().then((hasProject) => {
      setHasStoredProject(hasProject);
      setIsChecking(false);
    });
  }, []);

  // Show welcome if no stored project and not manually dismissed this session
  // Don't show while checking to avoid flash
  const showWelcome = !isChecking && !hasStoredProject && !manuallyDismissed;

  const handleWelcomeComplete = useCallback(() => {
    setManuallyDismissed(true);
    setHasStoredProject(true); // Project was just created
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
