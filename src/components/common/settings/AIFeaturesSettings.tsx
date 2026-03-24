import { useState, useCallback, useEffect, useRef } from 'react';
import { useSettingsStore, type LemonadeModel } from '../../../stores/settingsStore';
import { useMatAnyoneStore, type MatAnyoneSetupStatus } from '../../../stores/matanyoneStore';
import { lemonadeService } from '../../../services/lemonadeService';
import { MODEL_PRESETS } from '../../../services/lemonadeProvider';
import { Logger } from '../../../services/logger';

const log = Logger.create('AIFeaturesSettings');

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

function LemonadeStatusIndicator({ status }: { status: 'online' | 'offline' | 'checking' }) {
  const statusConfig = {
    online: { color: '#22c55e', label: 'Online' },
    offline: { color: '#ef4444', label: 'Offline' },
    checking: { color: '#f59e0b', label: 'Checking...' },
  };

  const config = statusConfig[status];

  return (
    <span style={{
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 3,
      background: `${config.color}22`,
      color: config.color,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: config.color,
        display: 'inline-block',
      }} />
      {config.label}
    </span>
  );
}

export function AIFeaturesSettings() {
  const {
    matanyoneEnabled,
    matanyonePythonPath,
    setMatAnyoneEnabled,
    setMatAnyonePythonPath,
    // Lemonade Server settings
    aiProvider,
    lemonadeModel,
    lemonadeUseFallback,
    setAiProvider,
    setLemonadeModel,
    setLemonadeUseFallback,
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
  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [testingConnection, setTestingConnection] = useState(false);

  // Mount guard ref to prevent state updates on unmounted component
  const isMountedRef = useRef(true);

  // Subscribe to Lemonade Server status updates
  useEffect(() => {
    isMountedRef.current = true;

    // Initial health check with mount guard
    lemonadeService.checkHealth().then(health => {
      if (isMountedRef.current) {
        setServerStatus(health.status);
      }
    });

    // Subscribe to status changes with mount guard
    const unsubscribe = lemonadeService.subscribe(status => {
      if (isMountedRef.current) {
        setServerStatus(status.available ? 'online' : 'offline');
      }
    });

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
  }, []);

  // useCallback for Test Connection handler with proper dependency
  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    try {
      const health = await lemonadeService.refresh();
      log.debug('Test connection result:', health);
    } catch (error) {
      log.error('Test connection failed:', error);
    } finally {
      setTestingConnection(false);
    }
  }, []);

  // useCallback for Refresh Status handler
  const handleRefreshStatus = useCallback(() => {
    lemonadeService.checkHealth().then(health => {
      setServerStatus(health.status);
    });
  }, []);

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
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        setMatAnyonePythonPath(dirHandle.name);
      }
    } catch {
      // User cancelled or API not available
    }
  }, [setMatAnyonePythonPath]);

  return (
    <div className="settings-category-content">
      <h2>AI Features</h2>

      {/* MatAnyone2 Section */}
      <div className="settings-group">
        <div className="settings-group-title">MatAnyone2 - AI Video Matting</div>

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

      {/* Lemonade Server Section */}
      <div className="settings-group" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
        <div className="settings-group-title">Lemonade Server - Local AI Inference</div>

        <label className="settings-row">
          <span className="settings-label">Use Lemonade for AI Chat</span>
          <input
            type="checkbox"
            checked={aiProvider === 'lemonade'}
            onChange={(e) => setAiProvider(e.target.checked ? 'lemonade' : 'openai')}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          Enable to use local AI inference instead of OpenAI API. Requires Lemonade Server running on your machine.
        </p>

        {aiProvider === 'lemonade' && (
          <>
            <div className="settings-row">
              <span className="settings-label">Server Status</span>
              <LemonadeStatusIndicator status={serverStatus} />
            </div>

            <label className="settings-row">
              <span className="settings-label">Default Model</span>
              <select
                value={lemonadeModel}
                onChange={(e) => setLemonadeModel(e.target.value as LemonadeModel)}
                className="settings-select"
                style={{ width: '280px' }}
              >
                {MODEL_PRESETS.map(preset => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} ({preset.size}) - {preset.description}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-row">
              <span className="settings-label">Fast Fallback Mode</span>
              <input
                type="checkbox"
                checked={lemonadeUseFallback}
                onChange={(e) => setLemonadeUseFallback(e.target.checked)}
                className="settings-checkbox"
              />
            </label>
            <p className="settings-hint">
              Use smaller model for simple commands. Faster response, lower reasoning quality.
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
              <button
                className="settings-button"
                onClick={handleTestConnection}
                disabled={testingConnection}
              >
                {testingConnection ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                className="settings-button"
                onClick={handleRefreshStatus}
              >
                Refresh Status
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
