import { useState, useCallback } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useMatAnyoneStore, type MatAnyoneSetupStatus } from '../../../stores/matanyoneStore';
import {
  checkLemonadeHealth,
  DEFAULT_LEMONADE_ENDPOINT,
  DEFAULT_LEMONADE_MODEL,
  LEMONADE_MODEL_PRESETS,
  type LemonadeModelInfo,
} from '../../../services/lemonadeProvider';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

function getStatusLabel(status: MatAnyoneSetupStatus): string {
  switch (status) {
    case 'not-checked':
    case 'not-available':
    case 'not-installed':
      return 'Not Installed';
    case 'installing':
      return 'Installing...';
    case 'model-needed':
    case 'downloading-model':
      return 'Installed';
    case 'installed':
      return 'Installed';
    case 'starting':
      return 'Starting...';
    case 'ready':
      return 'Running';
    case 'error':
      return 'Error';
    default:
      return 'Unknown';
  }
}

function getStatusColor(status: MatAnyoneSetupStatus): string {
  switch (status) {
    case 'not-checked':
    case 'not-available':
    case 'not-installed':
      return '#888';
    case 'installing':
    case 'starting':
    case 'downloading-model':
      return '#f59e0b';
    case 'model-needed':
    case 'installed':
      return '#3b82f6';
    case 'ready':
      return '#22c55e';
    case 'error':
      return '#ef4444';
    default:
      return '#888';
  }
}

interface AIFeaturesSettingsProps {
  embedded?: boolean;
}

export function AIFeaturesSettings({ embedded }: AIFeaturesSettingsProps = {}) {
  const {
    matanyoneEnabled,
    matanyonePythonPath,
    aiProvider,
    lemonadeEndpoint,
    lemonadeModel,
    setMatAnyoneEnabled,
    setMatAnyonePythonPath,
    setAiProvider,
    setLemonadeEndpoint,
    setLemonadeModel,
  } = useSettingsStore();

  const {
    setupStatus,
    pythonVersion,
    gpuName,
    vramMb,
    modelDownloaded,
    errorMessage,
  } = useMatAnyoneStore();

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [lemonadeStatus, setLemonadeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [lemonadeStatusMessage, setLemonadeStatusMessage] = useState('');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);

  const isInstalled = setupStatus === 'installed' || setupStatus === 'ready'
    || setupStatus === 'model-needed' || setupStatus === 'starting';
  const isRunning = setupStatus === 'ready';
  const isBusy = setupStatus === 'installing' || setupStatus === 'starting'
    || setupStatus === 'downloading-model';

  const formatVram = useCallback((mb: number | null): string => {
    if (mb === null) return '';
    if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
    return `${mb} MB`;
  }, []);

  const handleBrowsePython = useCallback(async () => {
    try {
      // Use the native file picker if available (showDirectoryPicker API)
      const pickerWindow = window as DirectoryPickerWindow;
      if (pickerWindow.showDirectoryPicker) {
        const dirHandle = await pickerWindow.showDirectoryPicker();
        setMatAnyonePythonPath(dirHandle.name);
      }
    } catch {
      // User cancelled or API not available
    }
  }, [setMatAnyonePythonPath]);

  const handleCheckLemonade = useCallback(async () => {
    setLemonadeStatus('checking');
    setLemonadeStatusMessage('');

    const health = await checkLemonadeHealth(lemonadeEndpoint);
    setLemonadeModels(health.models);
    setLemonadeStatus(health.available ? 'online' : 'offline');
    setLemonadeStatusMessage(health.available
      ? `${health.models.length} model${health.models.length === 1 ? '' : 's'} available`
      : health.error || 'Unable to reach Lemonade Server');
  }, [lemonadeEndpoint]);

  const lemonadeModelOptions = lemonadeModels.length > 0
    ? lemonadeModels.map((model) => ({ id: model.id, name: model.name || model.id }))
    : LEMONADE_MODEL_PRESETS.map((preset) => ({ id: preset.id, name: preset.name }));

  if (lemonadeModels.length === 0 && lemonadeModel && !lemonadeModelOptions.some((option) => option.id === lemonadeModel)) {
    lemonadeModelOptions.push({ id: lemonadeModel, name: lemonadeModel });
  }

  const configuredLemonadeModel = lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL;
  const selectedLemonadeModel = lemonadeModelOptions.some((option) => option.id === configuredLemonadeModel)
    ? configuredLemonadeModel
    : lemonadeModelOptions[0]?.id || '';

  const matAnyoneContent = (
    <>
      <div className="settings-group">
        <div className="settings-group-title">{embedded ? 'AI Features - Chat' : 'Chat Provider'}</div>

        <label className="settings-row">
          <span className="settings-label">Provider</span>
          <select
            className="settings-select"
            value={aiProvider}
            onChange={(e) => setAiProvider(e.target.value as 'openai' | 'lemonade')}
          >
            <option value="openai">OpenAI / Cloud</option>
            <option value="lemonade">Lemonade Local</option>
          </select>
        </label>

        <label className="settings-row">
          <span className="settings-label">Lemonade Endpoint</span>
          <input
            type="text"
            value={lemonadeEndpoint}
            onChange={(e) => {
              setLemonadeEndpoint(e.target.value);
              setLemonadeStatus('idle');
            }}
            placeholder={DEFAULT_LEMONADE_ENDPOINT}
            className="settings-input"
            style={{ width: 260 }}
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">Lemonade Model</span>
          <select
            className="settings-select"
            value={selectedLemonadeModel}
            onChange={(e) => setLemonadeModel(e.target.value)}
            disabled={lemonadeModelOptions.length === 0}
          >
            {lemonadeModelOptions.length === 0 && (
              <option value="">No Lemonade models found</option>
            )}
            {lemonadeModelOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-row">
          <span className="settings-label">Lemonade Status</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{
              fontSize: 11,
              color: lemonadeStatus === 'online'
                ? '#22c55e'
                : lemonadeStatus === 'offline'
                  ? '#ef4444'
                  : 'var(--text-secondary)',
            }}>
              {lemonadeStatus === 'idle'
                ? 'Not checked'
                : lemonadeStatus === 'checking'
                  ? 'Checking...'
                  : lemonadeStatusMessage}
            </span>
            <button
              className="settings-button"
              onClick={handleCheckLemonade}
              disabled={lemonadeStatus === 'checking'}
            >
              Check
            </button>
          </div>
        </div>
      </div>

      {/* MatAnyone2 Section */}
      <div className="settings-group">
        <div className="settings-group-title">{embedded ? 'AI Features — MatAnyone2' : 'MatAnyone2 - AI Video Matting'}</div>

        <label className="settings-row">
          <span className="settings-label">Enable MatAnyone2</span>
          <input
            type="checkbox"
            checked={matanyoneEnabled}
            onChange={(e) => setMatAnyoneEnabled(e.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          AI-powered video matting for extracting people with precise alpha channels.
        </p>
      </div>

      {matanyoneEnabled && (
        <>
          {/* Status Section */}
          <div className="settings-group">
            <div className="settings-group-title">Status</div>

            <div className="settings-row">
              <span className="settings-label">Setup Status</span>
              <span style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 3,
                background: `${getStatusColor(setupStatus)}22`,
                color: getStatusColor(setupStatus),
                fontWeight: 500,
              }}>
                {getStatusLabel(setupStatus)}
              </span>
            </div>

            {errorMessage && (
              <p className="settings-hint" style={{ color: '#ef4444' }}>
                {errorMessage}
              </p>
            )}

            <div className="settings-row">
              <span className="settings-label">GPU</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {gpuName
                  ? `${gpuName}${vramMb ? ` (${formatVram(vramMb)})` : ''}`
                  : 'No GPU detected'}
              </span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Python</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {pythonVersion || 'Not installed'}
              </span>
            </div>

            <div className="settings-row">
              <span className="settings-label">Model</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {modelDownloaded ? 'Downloaded (141 MB)' : 'Not downloaded'}
              </span>
            </div>
          </div>

          {/* Actions Section */}
          <div className="settings-group">
            <div className="settings-group-title">Actions</div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 0' }}>
              {!isInstalled && !isBusy && (
                <button
                  className="settings-button"
                  style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
                  disabled={isBusy}
                >
                  Set Up MatAnyone2
                </button>
              )}

              {isInstalled && !isRunning && (
                <button
                  className="settings-button"
                  disabled={isBusy}
                >
                  Start Server
                </button>
              )}

              {isRunning && (
                <button
                  className="settings-button"
                >
                  Stop Server
                </button>
              )}

              {isInstalled && !modelDownloaded && (
                <button
                  className="settings-button"
                  disabled={isBusy}
                >
                  Download Model
                </button>
              )}

              {isInstalled && (
                <>
                  {!confirmUninstall ? (
                    <button
                      className="settings-button"
                      style={{ color: '#ef4444', borderColor: '#ef4444' }}
                      onClick={() => setConfirmUninstall(true)}
                      disabled={isBusy}
                    >
                      Uninstall
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#ef4444' }}>Are you sure?</span>
                      <button
                        className="settings-button"
                        style={{ color: '#ef4444', borderColor: '#ef4444' }}
                        onClick={() => setConfirmUninstall(false)}
                      >
                        Confirm Uninstall
                      </button>
                      <button
                        className="settings-button"
                        onClick={() => setConfirmUninstall(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}

              {isBusy && (
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', alignSelf: 'center' }}>
                  {setupStatus === 'installing' && 'Installing...'}
                  {setupStatus === 'starting' && 'Starting server...'}
                  {setupStatus === 'downloading-model' && 'Downloading model...'}
                </span>
              )}
            </div>
          </div>

          {/* Advanced Section (collapsible) */}
          <div className="settings-group">
            <div
              className="settings-group-title"
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              {advancedOpen ? '\u25BC' : '\u25B6'} Advanced
            </div>

            {advancedOpen && (
              <>
                <label className="settings-row">
                  <span className="settings-label">Python Path</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      type="text"
                      value={matanyonePythonPath}
                      onChange={(e) => setMatAnyonePythonPath(e.target.value)}
                      placeholder="Auto-detect"
                      className="settings-input"
                      style={{ width: 180 }}
                    />
                    <button
                      className="settings-button"
                      onClick={handleBrowsePython}
                    >
                      Browse
                    </button>
                  </div>
                </label>
                <p className="settings-hint">
                  Leave empty to auto-detect Python. Set a custom path if Python is not on your system PATH.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  if (embedded) return matAnyoneContent;

  return (
    <div className="settings-category-content">
      <h2>AI Features</h2>
      {matAnyoneContent}
    </div>
  );
}
