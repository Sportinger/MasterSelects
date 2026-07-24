import { useMuscriptorStore } from '../../../stores/muscriptorStore';
import { getMuscriptorService } from '../../../services/muscriptor';
import type { MuscriptorDevice, MuscriptorModelVariant } from '../../../services/nativeHelper';
import { openMuscriptorDialog } from '../muscriptorSetup/dialogController';

const STATUS_LABELS: Record<ReturnType<typeof useMuscriptorStore.getState>['setupStatus'], string> = {
  'not-checked': 'Not checked',
  'not-available': 'Native Helper unavailable',
  'not-installed': 'Not installed',
  installing: 'Installing...',
  'model-needed': 'Model required',
  'downloading-model': 'Downloading...',
  installed: 'Installed',
  starting: 'Starting...',
  ready: 'Running locally',
  error: 'Error',
};

export function MuscriptorFeatureSettings() {
  const state = useMuscriptorStore();
  const busy = state.isProcessing || ['installing', 'downloading-model', 'starting'].includes(state.setupStatus);

  return (
    <div className="settings-group">
      <div className="settings-group-title">Music to MIDI — MuScriptor</div>
      <p className="settings-hint">
        Runs locally through Native Helper and creates one General MIDI track per detected instrument.
      </p>

      <div className="settings-row">
        <span className="settings-label">Status</span>
        <span style={{ fontSize: 11, color: state.setupStatus === 'ready' ? '#22c55e' : 'var(--text-secondary)' }}>
          {STATUS_LABELS[state.setupStatus]}
        </span>
      </div>
      <label className="settings-row">
        <span className="settings-label">Model</span>
        <select
          className="settings-select"
          value={state.variant}
          disabled={busy || state.setupStatus === 'ready'}
          onChange={event => state.setVariant(event.target.value as MuscriptorModelVariant)}
        >
          <option value="small">Small · 103M (default)</option>
          <option value="medium">Medium · 307M</option>
          <option value="large">Large · 1.4B</option>
        </select>
      </label>
      <label className="settings-row">
        <span className="settings-label">Device</span>
        <select
          className="settings-select"
          value={state.device}
          disabled={busy || state.setupStatus === 'ready'}
          onChange={event => state.setDevice(event.target.value as MuscriptorDevice)}
        >
          <option value="auto">Auto</option>
          <option value="cpu">CPU</option>
          <option value="cuda">CUDA GPU</option>
        </select>
      </label>

      {state.errorMessage && <p className="settings-hint" style={{ color: '#ef4444' }}>{state.errorMessage}</p>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0' }}>
        <button className="settings-button" disabled={busy} onClick={() => openMuscriptorDialog()}>
          Setup / Models...
        </button>
        <button className="settings-button" disabled={busy} onClick={() => void getMuscriptorService().checkStatus()}>
          Refresh
        </button>
        {state.setupStatus === 'installed' && (
          <button className="settings-button" disabled={busy} onClick={() => void getMuscriptorService().start()}>
            Start server
          </button>
        )}
        {state.setupStatus === 'ready' && (
          <button className="settings-button" disabled={busy} onClick={() => void getMuscriptorService().stop()}>
            Stop server
          </button>
        )}
      </div>
      <p className="settings-hint">
        Kyutai × Mirelo model weights are CC BY-NC 4.0 (non-commercial use).{' '}
        <a href={`https://huggingface.co/MuScriptor/muscriptor-${state.variant}`} target="_blank" rel="noreferrer">Model page / license</a>
      </p>
    </div>
  );
}
