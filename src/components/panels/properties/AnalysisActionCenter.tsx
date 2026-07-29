import { useState, type ReactNode } from 'react';
import {
  IconActivity,
  IconCut,
  IconFileText,
  IconSettings,
  IconSparkles,
  IconUsers,
} from '@tabler/icons-react';
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
  compactStatusText?: string;
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
  advancedControls?: ReactNode;
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

function actionIntent(action: AnalysisAction): string {
  if (isRunning(action.state)) return 'Cancel';
  if (action.secondaryAction) return action.secondaryAction.label;
  if (action.state === 'ready') return 'Reanalyze';
  if (action.state === 'error') return 'Retry';
  return 'Analyze';
}

function compactStatus(action: AnalysisAction): string | undefined {
  const leadingValue = action.statusText.match(/^(\d+(?:\.\d+)?%?)/)?.[1];
  if (isRunning(action.state)) return action.compactStatusText ?? leadingValue ?? '…';
  if (action.state === 'error') return '!';
  if (action.state !== 'ready') return undefined;
  if (action.id === 'metrics' && leadingValue === '100%') return undefined;
  return leadingValue;
}

function ActionIcon({ id }: { id: string }) {
  const props = { 'aria-hidden': true, size: 15, stroke: 1.9 } as const;
  if (id === 'metrics') return <IconActivity {...props} />;
  if (id === 'faces') return <IconUsers {...props} />;
  if (id === 'cuts') return <IconCut {...props} />;
  if (id === 'transcript') return <IconFileText {...props} />;
  return <IconSparkles {...props} />;
}

function AnalysisActionPill({ action }: { action: AnalysisAction }) {
  const running = isRunning(action.state);
  const status = compactStatus(action);
  const onClick = running
    ? (action.onCancel ?? action.onRun)
    : (action.secondaryAction?.onClick ?? action.onRun);
  return (
    <button
      type="button"
      className={[
        'analysis-action-pill',
        `state-${action.state}`,
        `analysis-action-pill--${action.id}`,
      ].join(' ')}
      disabled={Boolean(action.disabled && !running)}
      onClick={onClick}
      title={`${action.detail} · ${action.statusText} · ${actionIntent(action)}`}
    >
      <ActionIcon id={action.id} />
      <span>{action.title}</span>
      {status && <strong>{status}</strong>}
    </button>
  );
}

function AnalysisConfigurationControls({ configuration }: { configuration: AnalysisActionConfiguration }) {
  return (
    <section className="analysis-settings-area" aria-label="Focus, motion, and face settings">
      <h5 className="analysis-settings-area__title">
        <IconActivity aria-hidden="true" size={14} stroke={1.9} />
        <span>Focus &amp; motion</span>
        <span className="analysis-settings-area__divider">/</span>
        <IconUsers aria-hidden="true" size={14} stroke={1.9} />
        <span>Faces</span>
      </h5>
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
    </section>
  );
}

export function AnalysisActionCenter({
  actions,
  advancedControls,
  configuration,
  analyzeAllDisabled = false,
  analyzeAllRunning = false,
  clearDisabled = false,
  onAnalyzeAll,
  onClearAll,
}: AnalysisActionCenterProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  return (
    <section className="properties-section analysis-action-center">
      <div className="analysis-action-bar">
        <h4>Analysis</h4>
        <div className="analysis-action-pills">
          {actions.map((action) => <AnalysisActionPill key={action.id} action={action} />)}
        </div>
        <button
          type="button"
          className="analysis-action-all"
          onClick={onAnalyzeAll}
          disabled={analyzeAllDisabled}
        >
          {analyzeAllRunning ? 'Analyzing…' : 'Analyze all'}
        </button>
        <button
          type="button"
          className={`analysis-action-settings${advancedOpen ? ' is-open' : ''}`}
          aria-expanded={advancedOpen}
          aria-label="Analysis settings"
          title="Analysis settings"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <IconSettings aria-hidden="true" size={16} stroke={1.9} />
        </button>
      </div>
      {advancedOpen && (
        <div className="analysis-action-advanced">
          {configuration && <AnalysisConfigurationControls configuration={configuration} />}
          {advancedControls}
          <div className="analysis-action-advanced__footer">
            <button
              type="button"
              className="analysis-action-clear"
              onClick={onClearAll}
              disabled={clearDisabled}
            >
              Clear analysis
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
