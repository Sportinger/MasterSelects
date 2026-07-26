import type { AnalysisStatus } from '../../../types';
import './AnalysisActionCenter.css';

type ActionState = AnalysisStatus | 'describing';

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
  analyzeAllDisabled?: boolean;
  analyzeAllRunning?: boolean;
  clearDisabled?: boolean;
  onAnalyzeAll: () => void;
  onClearAll: () => void;
}

function isRunning(state: ActionState): boolean {
  return state === 'analyzing' || state === 'describing';
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

export function AnalysisActionCenter({
  actions,
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
      <div className="analysis-action-list">
        {actions.map(action => <AnalysisActionRow key={action.id} action={action} />)}
      </div>
    </div>
  );
}
