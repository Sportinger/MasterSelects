import type {
  TranscriptFusionProviderStatus,
  TranscriptFusionStage,
  TranscriptProviderProgress,
} from '../../../types/clipMetadata';
import type { TranscriptionProvider } from '../../../stores/settingsStore';
import './TranscriptWorkspaceHeader.css';

export interface TranscriptRunView {
  finalDetail: string;
  finalProgress?: number;
  finalStatus: TranscriptFusionProviderStatus;
  overallProgress: number;
  providers: Record<'deepgram' | 'openai', TranscriptFusionProviderStatus>;
  providerProgress?: Record<'deepgram' | 'openai', TranscriptProviderProgress>;
  stage: TranscriptFusionStage;
}

export interface TranscriptSummaryView {
  providers?: Record<'deepgram' | 'openai', TranscriptFusionProviderStatus>;
  stage: TranscriptFusionStage;
}

interface TranscriptWorkspaceHeaderProps {
  activeProvider: TranscriptionProvider;
  clipCoverage: number;
  hasTranscript: boolean;
  isPartial: boolean;
  isSignedIn: boolean;
  language: string;
  onCancel: () => void;
  onContinue: () => void;
  onDelete: () => void;
  onLanguageChange: (language: string) => void;
  onProviderChange: (provider: TranscriptionProvider) => void;
  onSearchChange: (query: string) => void;
  onTranscribe: () => void;
  run: TranscriptRunView | null;
  searchQuery: string;
  settingsMode?: boolean;
  summary: TranscriptSummaryView | null;
  transcriptProgress: number;
  transcriptStatus: 'none' | 'transcribing' | 'ready' | 'error';
}

const LANGUAGES = [
  { code: 'auto', name: 'Auto-Detect' },
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
];

const TRANSCRIPTION_MODES: Array<{
  hosted: boolean;
  id: TranscriptionProvider;
  label: string;
  shortLabel: string;
}> = [
  { id: 'local', label: 'Local Whisper', shortLabel: 'Local Whisper', hosted: false },
  { id: 'openai', label: 'OpenAI Whisper', shortLabel: 'OpenAI', hosted: true },
  { id: 'deepgram', label: 'Deepgram Nova-3', shortLabel: 'Deepgram', hosted: true },
  {
    id: 'hybrid',
    label: 'Best Quality — Deepgram + OpenAI',
    shortLabel: 'Best Quality',
    hosted: true,
  },
];

const STAGE_LABELS: Record<TranscriptFusionStage, string> = {
  transcribing: 'Listening',
  aligning: 'Mapping speakers',
  finalizing: 'Applying speakers',
  complete: 'Ready',
  error: 'Stopped',
};

const STATUS_LABELS: Record<TranscriptFusionProviderStatus, string> = {
  waiting: 'Waiting',
  running: 'Running',
  complete: 'Done',
  error: 'Failed',
};

function RunStage({
  detail,
  label,
  progress,
  status,
}: {
  detail: string;
  label: string;
  progress?: number;
  status: TranscriptFusionProviderStatus;
}) {
  const boundedProgress = progress === undefined
    ? undefined
    : Math.max(0, Math.min(100, progress));
  return (
    <div className={`transcript-run-stage state-${status}`}>
      <div className="transcript-run-stage-heading">
        <span className="transcript-run-stage-label">
          <span className="transcript-run-stage-dot" aria-hidden="true" />
          {label}
        </span>
        <span>
          {boundedProgress === undefined ? '' : `${Math.round(boundedProgress)}% · `}
          {STATUS_LABELS[status]}
        </span>
      </div>
      <div
        aria-label={`${label}: ${STATUS_LABELS[status]}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={boundedProgress}
        className="transcript-run-stage-rail"
        role="progressbar"
      >
        <span
          className={[
            'transcript-run-stage-fill',
            status === 'running' && boundedProgress === undefined ? 'indeterminate' : '',
          ].filter(Boolean).join(' ')}
          style={boundedProgress === undefined ? undefined : { width: `${boundedProgress}%` }}
        />
      </div>
      <span className="transcript-run-stage-detail">{detail}</span>
    </div>
  );
}

function TranscriptRunStatus({
  activeProvider,
  run,
  transcriptProgress,
}: {
  activeProvider: TranscriptionProvider;
  run: TranscriptRunView | null;
  transcriptProgress: number;
}) {
  const mode = TRANSCRIPTION_MODES.find(candidate => candidate.id === activeProvider);
  const overallProgress = run?.overallProgress ?? transcriptProgress;
  return (
    <section className="transcript-run-status" aria-live="polite">
      <div className="transcript-run-overview">
        <span className="transcript-run-live-dot" aria-hidden="true" />
        <strong>{mode?.shortLabel ?? 'Transcription'}</strong>
        <span className="transcript-run-stage-name">
          {run ? STAGE_LABELS[run.stage] : 'Transcribing'}
        </span>
        <span className="transcript-run-percent">{overallProgress}%</span>
      </div>
      <div className="transcript-run-overall-rail" aria-hidden="true">
        <span style={{ width: `${overallProgress}%` }} />
      </div>
      {run && (
        <div className="transcript-run-stages">
          <RunStage
            detail={run.providerProgress
              ? `${run.providerProgress.deepgram.completedChunks}/${run.providerProgress.deepgram.totalChunks} chunks · text, timing, confidence`
              : 'Text · word timing · confidence'}
            label="Deepgram"
            progress={run.providerProgress?.deepgram.percent}
            status={run.providers.deepgram}
          />
          <RunStage
            detail={run.providerProgress
              ? `${run.providerProgress.openai.completedChunks}/${run.providerProgress.openai.totalChunks} chunks · speaker separation`
              : 'Speaker separation only'}
            label="OpenAI"
            progress={run.providerProgress?.openai.percent}
            status={run.providers.openai}
          />
          <RunStage
            detail={run.finalDetail}
            label="Merge"
            progress={run.finalProgress}
            status={run.finalStatus}
          />
        </div>
      )}
    </section>
  );
}

function TranscriptResultStatus({ summary }: { summary: TranscriptSummaryView }) {
  const openAIFailed = summary.providers?.openai === 'error';
  return (
    <section className="transcript-result-status">
      <div className="transcript-result-main">
        <span className="transcript-result-ready">
          <span aria-hidden="true">✓</span>
          {openAIFailed ? 'Transcript ready with speaker fallback' : 'Best Quality ready'}
        </span>
        <span className="transcript-provider-role">Deepgram text + timing</span>
        <span className="transcript-provider-role">
          {openAIFailed ? 'OpenAI failed for one or more chunks · Deepgram speakers kept' : 'OpenAI speakers'}
        </span>
      </div>
    </section>
  );
}

export function TranscriptWorkspaceHeader({
  activeProvider,
  clipCoverage,
  hasTranscript,
  isPartial,
  isSignedIn,
  language,
  onCancel,
  onContinue,
  onDelete,
  onLanguageChange,
  onProviderChange,
  onSearchChange,
  onTranscribe,
  run,
  searchQuery,
  settingsMode = false,
  summary,
  transcriptProgress,
  transcriptStatus,
}: TranscriptWorkspaceHeaderProps) {
  const isBusy = transcriptStatus === 'transcribing';
  return (
    <header className="transcript-workspace-header">
      <div className="transcript-command-row">
        <div className="transcript-config-fields">
          <label className="transcript-compact-field">
            <span>Language</span>
            <select
              disabled={isBusy}
              onChange={event => onLanguageChange(event.target.value)}
              value={language}
            >
              {LANGUAGES.map(option => (
                <option key={option.code} value={option.code}>{option.name}</option>
              ))}
            </select>
          </label>
          <label className="transcript-compact-field transcript-mode-field">
            <span>Mode</span>
            <select
              disabled={isBusy}
              onChange={event => onProviderChange(event.target.value as TranscriptionProvider)}
              value={activeProvider}
            >
              {TRANSCRIPTION_MODES.map(mode => (
                <option
                  disabled={isSignedIn && !mode.hosted}
                  key={mode.id}
                  value={mode.id}
                >
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="transcript-command-actions">
          {transcriptStatus !== 'ready' && !isBusy && !isPartial && (
            <button className="btn btn-sm btn-accent" onClick={onTranscribe}>Transcribe</button>
          )}
          {!isBusy && isPartial && (
            <button className="btn btn-sm btn-accent" onClick={onContinue}>
              Resume {Math.round(clipCoverage * 100)}%
            </button>
          )}
          {isBusy && (
            <button className="btn btn-sm transcript-cancel-button" onClick={onCancel}>Cancel</button>
          )}
          {transcriptStatus === 'ready' && (
            <>
              <button className="btn btn-sm" onClick={onTranscribe}>Re-transcribe</button>
              <button className="btn btn-sm transcript-delete-button" onClick={onDelete}>Delete</button>
            </>
          )}
          {transcriptStatus === 'error' && isPartial && (
            <button className="btn btn-sm transcript-delete-button" onClick={onDelete}>Delete</button>
          )}
        </div>
      </div>

      {!settingsMode && (isBusy ? (
        <TranscriptRunStatus
          activeProvider={activeProvider}
          run={run}
          transcriptProgress={transcriptProgress}
        />
      ) : summary && transcriptStatus === 'ready' ? (
        <TranscriptResultStatus summary={summary} />
      ) : null)}

      {!settingsMode && transcriptStatus === 'ready' && clipCoverage > 0 && (
        <div className="transcript-coverage-row">
          <div className="transcript-coverage-rail">
            <span style={{ width: `${Math.round(clipCoverage * 100)}%` }} />
          </div>
          <span>{Math.round(clipCoverage * 100)}% covered</span>
        </div>
      )}

      {!settingsMode && hasTranscript && (
        <div className="transcript-find-row">
          <input
            aria-label="Search transcript"
            className="transcript-search-input"
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Search transcript…"
            type="search"
            value={searchQuery}
          />
        </div>
      )}
    </header>
  );
}
