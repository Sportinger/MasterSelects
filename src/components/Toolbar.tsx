// Toolbar component

import { useEngine } from '../hooks/useEngine';
import { useMixerStore } from '../stores/mixerStore';
import { useMIDI } from '../hooks/useMIDI';

export function Toolbar() {
  const { isEngineReady, createOutputWindow } = useEngine();
  const { isPlaying, setPlaying, outputResolution, setResolution } = useMixerStore();
  const { isSupported: midiSupported, isEnabled: midiEnabled, enableMIDI, disableMIDI, devices } = useMIDI();

  const handleNewOutput = () => {
    const output = createOutputWindow(`Output ${Date.now()}`);
    if (output) {
      console.log('Created output window:', output.id);
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <span className="logo">WebVJ Mixer</span>
      </div>

      <div className="toolbar-section">
        <button
          className={`btn ${isPlaying ? 'btn-active' : ''}`}
          onClick={() => setPlaying(!isPlaying)}
          disabled={!isEngineReady}
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>

      <div className="toolbar-section">
        <label>Resolution:</label>
        <select
          value={`${outputResolution.width}x${outputResolution.height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            setResolution(w, h);
          }}
        >
          <option value="1920x1080">1920×1080 (1080p)</option>
          <option value="1280x720">1280×720 (720p)</option>
          <option value="3840x2160">3840×2160 (4K)</option>
          <option value="1920x1200">1920×1200 (16:10)</option>
          <option value="1024x768">1024×768 (4:3)</option>
        </select>
      </div>

      <div className="toolbar-section">
        <button className="btn" onClick={handleNewOutput} disabled={!isEngineReady}>
          + Output Window
        </button>
      </div>

      <div className="toolbar-section">
        {midiSupported ? (
          <button
            className={`btn ${midiEnabled ? 'btn-active' : ''}`}
            onClick={() => (midiEnabled ? disableMIDI() : enableMIDI())}
          >
            🎹 MIDI {midiEnabled ? `(${devices.length})` : 'Off'}
          </button>
        ) : (
          <span className="midi-unsupported">MIDI not supported</span>
        )}
      </div>

      <div className="toolbar-section toolbar-right">
        <span className={`status ${isEngineReady ? 'ready' : 'loading'}`}>
          {isEngineReady ? '● WebGPU Ready' : '○ Loading...'}
        </span>
      </div>
    </div>
  );
}
