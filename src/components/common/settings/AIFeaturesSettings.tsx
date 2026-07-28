import { useState, useCallback } from 'react';
import {
  useSettingsStore,
  type GuidedActionReplayCompressionMode,
  type GuidedActionReplayVisualizationMode,
} from '../../../stores/settingsStore';
import { useMatAnyoneStore, type MatAnyoneSetupStatus } from '../../../stores/matanyoneStore';
import { getMatAnyoneService } from '../../../services/matanyone/MatAnyoneService';
import { MatAnyoneSetupDialog } from '../MatAnyoneSetupDialog';
import { MuscriptorFeatureSettings } from './MuscriptorFeatureSettings';
import {
  checkLemonadeHealth,
  DEFAULT_LEMONADE_ENDPOINT,
  DEFAULT_LEMONADE_MODEL,
  LEMONADE_MODEL_PRESETS,
  type LemonadeModelInfo,
} from '../../../services/lemonadeProvider';

type ReplayBudgetUnit = 'ms' | 's' | 'min' | 'h';

const REPLAY_BUDGET_UNIT_MS: Record<ReplayBudgetUnit, number> = {
  ms: 1,
  s: 1000,
  min: 60_000,
  h: 3_600_000,
};

function getDefaultReplayBudgetUnit(budgetMs: number): ReplayBudgetUnit {
  if (budgetMs >= REPLAY_BUDGET_UNIT_MS.h && budgetMs % REPLAY_BUDGET_UNIT_MS.h === 0) return 'h';
  if (budgetMs >= REPLAY_BUDGET_UNIT_MS.min && budgetMs % REPLAY_BUDGET_UNIT_MS.min === 0) return 'min';
  if (budgetMs >= REPLAY_BUDGET_UNIT_MS.s && budgetMs % REPLAY_BUDGET_UNIT_MS.s === 0) return 's';
  return 'ms';
}

function getReplayBudgetStep(unit: ReplayBudgetUnit): number {
  switch (unit) {
    case 'h':
      return 0.01;
    case 'min':
      return 0.1;
    case 's':
      return 0.25;
    case 'ms':
      return 250;
  }
}

function formatReplayBudgetValue(budgetMs: number, unit: ReplayBudgetUnit): string {
  const value = budgetMs / REPLAY_BUDGET_UNIT_MS[unit];
  if (unit === 'ms' || Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(3)));
}

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
    aiProvider,
    lemonadeEndpoint,
    lemonadeModel,
    guidedActionReplayVisualizationMode,
    guidedActionReplayBudgetMs,
    guidedActionReplayCompressionMode,
    setMatAnyoneEnabled,
    setAiProvider,
    setLemonadeEndpoint,
    setLemonadeModel,
    setGuidedActionReplayVisualizationMode,
    setGuidedActionReplayBudgetMs,
    setGuidedActionReplayCompressionMode,
  } = useSettingsStore();

  const {
    setupStatus,
    pythonVersion,
    gpuName,
    vramMb,
    modelDownloaded,
    errorMessage,
  } = useMatAnyoneStore();

  const [showMatAnyoneSetup, setShowMatAnyoneSetup] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [lemonadeStatus, setLemonadeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [lemonadeStatusMessage, setLemonadeStatusMessage] = useState('');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);
  const [replayBudgetUnit, setReplayBudgetUnit] = useState<ReplayBudgetUnit>(() => (
    getDefaultReplayBudgetUnit(guidedActionReplayBudgetMs)
  ));

  const isInstalled = setupStatus === 'installed' || setupStatus === 'ready'
    || setupStatus === 'model-needed' || setupStatus === 'starting';
  const isRunning = setupStatus === 'ready';
  const isBusy = setupStatus === 'installing' || setupStatus === 'starting'
    || setupStatus === 'downloading-model';
  const replayBudgetValue = formatReplayBudgetValue(guidedActionReplayBudgetMs, replayBudgetUnit);

  const handleReplayBudgetValueChange = useCallback((value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    setGuidedActionReplayBudgetMs(parsed * REPLAY_BUDGET_UNIT_MS[replayBudgetUnit]);
  }, [replayBudgetUnit, setGuidedActionReplayBudgetMs]);

  const formatVram = useCallback((mb: number | null): string => {
    if (mb === null) return '';
    if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
    return `${mb} MB`;
  }, []);

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
      {showMatAnyoneSetup && <MatAnyoneSetupDialog onClose={() => setShowMatAnyoneSetup(false)} />}
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

      <div className="settings-group">
        <div className="settings-group-title">AI Replay</div>

        <label className="settings-row">
          <span className="settings-label">Replay View</span>
          <select
            className="settings-select"
            value={guidedActionReplayVisualizationMode}
            onChange={(e) => setGuidedActionReplayVisualizationMode(e.target.value as GuidedActionReplayVisualizationMode)}
          >
            <option value="concise">Concise</option>
            <option value="full">Full</option>
            <option value="off">Off</option>
          </select>
        </label>

        <label className="settings-row">
          <span className="settings-label">Animation Budget</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 230, justifyContent: 'flex-end' }}>
            <input
              type="number"
              min={0}
              step={getReplayBudgetStep(replayBudgetUnit)}
              value={replayBudgetValue}
              onChange={(e) => handleReplayBudgetValueChange(e.target.value)}
              className="settings-input settings-input-number"
              style={{ width: 92 }}
              disabled={guidedActionReplayVisualizationMode === 'off'}
            />
            <select
              className="settings-select"
              value={replayBudgetUnit}
              onChange={(e) => setReplayBudgetUnit(e.target.value as ReplayBudgetUnit)}
              disabled={guidedActionReplayVisualizationMode === 'off'}
              style={{ width: 76 }}
            >
              <option value="ms">ms</option>
              <option value="s">sec</option>
              <option value="min">min</option>
              <option value="h">hours</option>
            </select>
          </div>
        </label>

        <label className="settings-row">
          <span className="settings-label">Compression</span>
          <select
            className="settings-select"
            value={guidedActionReplayCompressionMode}
            onChange={(e) => setGuidedActionReplayCompressionMode(e.target.value as GuidedActionReplayCompressionMode)}
            disabled={guidedActionReplayVisualizationMode === 'off' || guidedActionReplayBudgetMs === 0}
          >
            <option value="family">Grouped</option>
            <option value="none">None</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>
        <p className="settings-hint">
          0 keeps execution checks but skips visual animation. Large values are allowed; replay uses the entered total duration.
        </p>
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
                  onClick={() => setShowMatAnyoneSetup(true)}
                >
                  Set Up MatAnyone2
                </button>
              )}

              {isInstalled && !isRunning && (
                <button
                  className="settings-button"
                  disabled={isBusy}
                  onClick={() => void getMatAnyoneService().startServer()}
                >
                  Start Server
                </button>
              )}

              {isRunning && (
                <button
                  className="settings-button"
                  onClick={() => void getMatAnyoneService().stopServer()}
                >
                  Stop Server
                </button>
              )}

              {isInstalled && !modelDownloaded && (
                <button
                  className="settings-button"
                  disabled={isBusy}
                  onClick={() => void getMatAnyoneService().downloadModel()}
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
                        onClick={() => {
                          setConfirmUninstall(false);
                          void getMatAnyoneService().uninstall();
                        }}
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

        </>
      )}

      <MuscriptorFeatureSettings />
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
