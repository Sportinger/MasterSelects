// WebVJ Mixer - Main Application

import { Toolbar } from './components';
import { DockContainer } from './components/dock';
import { useGlobalHistory } from './hooks/useGlobalHistory';
import './App.css';

function App() {
  // Initialize global undo/redo system
  useGlobalHistory();

  return (
    <div className="app">
      <Toolbar />
      <DockContainer />
    </div>
  );
}

export default App;
