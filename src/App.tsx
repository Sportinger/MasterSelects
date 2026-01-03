// WebVJ Mixer - Main Application

import { Toolbar } from './components';
import { DockContainer } from './components/dock';
import './App.css';

function App() {
  return (
    <div className="app">
      <Toolbar />
      <DockContainer />
    </div>
  );
}

export default App;
