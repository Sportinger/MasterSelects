import type { AnalysisStatus } from '../../../types/clipMetadata';
import type {
  AgentTimelineAnalysisEstimate,
  AgentTimelineAnalysisScopeKind,
} from '../../../types/agentTimeline/analysisEstimate';
import type { AgentTimelineProfile } from '../../../types/agentTimeline/manifest';
import './AnalysisActionCenter.css';

type ActionState = AnalysisStatus | 'describing' | 'transcribing';

interface AnalysisAction {
  id: string;
  title: string;
  detail: string;
  state: ActionState;
  statusText: string;
  onRun: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

interface AnalysisActionCenterProps {
  actions: readonly AnalysisAction[];
  configuration?: AnalysisActionConfiguration;
  analyzeAllDisabled?: boolean;
  analyzeAllRunning?: boolean;
  clearDisabled?: boolean;
  onAnalyzeAll: () => void;
  onClearAll: () => void;
}

export interface AnalysisActionScopeOption {
  id: Extract<AgentTimelineAnalysisScopeKind, 'source' | 'used-ranges' | 'selection' | 'in-out'>;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface AnalysisActionConfiguration {
  scope: AnalysisActionScopeOption['id'];
  profile: AgentTimelineProfile;
  scopes: readonly AnalysisActionScopeOption[];
  estimate?: AgentTimelineAnalysisEstimate;
  estimateUnavailableReason?: string;
  executionNote: string;
  onScopeChange: (scope: AnalysisActionScopeOption['id']) => void;
  onProfileChange: (profile: AgentTimelineProfile) => void;
}

function isRunning(state: ActionState): boolean {
  return state === 'analyzing' || state === 'describing' || state === 'transcribing';
}

function actionLabel(state: ActionState): string {
  if (state === 'ready') return 'Reanalyze';
  if (state === 'error') return 'Retry';
  return 'Analyze';
}

function AnalysisActionRow({ action }: { action: AnalysisAction }) {
  const running = isRunning(action.state);
  return (
    <div className="analysis-action-row">
      <div className="analysis-action-copy">
        <span className="analysis-action-title">{action.title}</span>
        <span className="analysis-action-detail">{action.detail}</span>
        <span className={`analysis-action-status state-${action.state}`}>
          {action.statusText}
        </span>
      </div>
      <div className="analysis-action-buttons">
        {action.secondaryAction && !running && (
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={action.secondaryAction.onClick}
            disabled={action.disabled}
          >
            {action.secondaryAction.label}
          </button>
        )}
        <button
          type="button"
          className={`btn btn-sm${running ? ' btn-danger' : ''}`}
          onClick={running ? action.onCancel : action.onRun}
          disabled={action.disabled && !running}
        >
          {running ? 'Cancel' : actionLabel(action.state)}
        </button>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatWork(estimate: AgentTimelineAnalysisEstimate, channel: string): string | undefined {
  const entry = estimate.channels.find((candidate) => candidate.channel === channel);
  if (!entry?.workItemKind || entry.estimatedWorkItems === undefined) return undefined;
  const label = entry.workItemKind === 'candidate-samples'
    ? 'candidate samples'
    : entry.workItemKind;
  return `${entry.estimatedWorkItems.toLocaleString()} ${label}`;
}

function AnalysisConfigurationControls({ configuration }: { configuration: AnalysisActionConfiguration }) {
  const { estimate } = configuration;
  const work = estimate
    ? [
      formatWork(estimate, 'cuts'),
      formatWork(estimate, 'quality'),
      formatWork(estimate, 'people'),
      formatWork(estimate, 'text'),
    ].filter((item): item is string => Boolean(item))
    : [];

  return (
    <section className="analysis-configuration" aria-label="Analysis scope and profile">
      <div className="analysis-configuration__groups">
        <div className="analysis-choice-group" role="group" aria-label="Analysis scope">
          <span className="analysis-choice-group__label">Scope</span>
          <div className="analysis-choice-group__buttons">
            {configuration.scopes.map((scope) => (
              <button
                type="button"
                className={`analysis-choice${configuration.scope === scope.id ? ' analysis-choice--active' : ''}`}
                key={scope.id}
                aria-pressed={configuration.scope === scope.id}
                disabled={scope.disabled}
                title={scope.disabledReason}
                onClick={() => configuration.onScopeChange(scope.id)}
              >
                {scope.label}
              </button>
            ))}
          </div>
        </div>
        <div className="analysis-choice-group" role="group" aria-label="Analysis profile">
          <span className="analysis-choice-group__label">Profile</span>
          <div className="analysis-choice-group__buttons">
            {(['quick', 'balanced', 'deep', 'custom'] as const).map((profile) => (
              <button
                type="button"
                className={`analysis-choice${configuration.profile === profile ? ' analysis-choice--active' : ''}`}
                key={profile}
                aria-pressed={configuration.profile === profile}
                onClick={() => configuration.onProfileChange(profile)}
              >
                {profile[0].toUpperCase() + profile.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="analysis-estimate" aria-live="polite">
        {estimate ? (
          <>
            <span className={`analysis-estimate__cost analysis-estimate__cost--${estimate.relativeCost}`}>
              {estimate.relativeCost} cost
            </span>
            <span>{formatDuration(estimate.uncachedDurationSeconds)} uncached / {formatDuration(estimate.totalDurationSeconds)}</span>
            {work.length > 0 && <span>{work.join(' · ')}</span>}
            <span>{estimate.channels.reduce((total, entry) => total + entry.reusableDurationSeconds, 0) > 0
              ? 'Warm-cache artifacts reused'
              : 'No reusable artifacts in this scope'}</span>
            <span>{estimate.estimatedWallTimeSeconds
              ? `${formatDuration(estimate.estimatedWallTimeSeconds.minimum)}–${formatDuration(estimate.estimatedWallTimeSeconds.maximum)} on ${estimate.estimatedWallTimeSeconds.deviceClass}`
              : 'Time estimate awaits a matching device benchmark'}</span>
          </>
        ) : (
          <span>{configuration.estimateUnavailableReason ?? 'Choose an available scope to preview work.'}</span>
        )}
      </div>
      <p className="analysis-configuration__note">{configuration.executionNote}</p>
    </section>
  );
}

export function AnalysisActionCenter({
  actions,
  configuration,
  analyzeAllDisabled = false,
  analyzeAllRunning = false,
  clearDisabled = false,
  onAnalyzeAll,
  onClearAll,
}: AnalysisActionCenterProps) {
  return (
    <div className="properties-section analysis-action-center">
      <div className="analysis-action-heading">
        <h4>Analysis</h4>
        <div className="analysis-action-global-buttons">
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={onAnalyzeAll}
            disabled={analyzeAllDisabled}
          >
            {analyzeAllRunning ? 'Analyzing All…' : 'Analyze All'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={onClearAll}
            disabled={clearDisabled}
          >
            Clear Analysis
          </button>
        </div>
      </div>
      {configuration && <AnalysisConfigurationControls configuration={configuration} />}
      <div className="analysis-action-list">
        {actions.map(action => <AnalysisActionRow key={action.id} action={action} />)}
      </div>
    </div>
  );
}
