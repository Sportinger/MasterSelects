import type { BatchExportJob } from '../../../stores/exportStore';
import type { BatchExportRuntimeMap } from './batchRuntimeTypes';

interface BatchExportQueueProps {
  jobs: BatchExportJob[];
  selectedJobId: string | null;
  enabled: boolean;
  useSharedSettings: boolean;
  runtimeByJob: BatchExportRuntimeMap;
  isRunning: boolean;
  onToggleEnabled: () => void;
  onToggleSharedSettings: () => void;
  onSelectJob: (jobId: string) => void;
  onRemoveJob: (jobId: string) => void;
  onClear: () => void;
  onCancel: () => void;
}

function statusLabel(runtime: BatchExportRuntimeMap[string] | undefined): string {
  if (!runtime) return 'Ready';
  switch (runtime.status) {
    case 'resolving': return 'Opening';
    case 'encoding': return `${Math.round(runtime.progress)}%`;
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return 'Ready';
  }
}

export function BatchExportQueue({
  jobs,
  selectedJobId,
  enabled,
  useSharedSettings,
  runtimeByJob,
  isRunning,
  onToggleEnabled,
  onToggleSharedSettings,
  onSelectJob,
  onRemoveJob,
  onClear,
  onCancel,
}: BatchExportQueueProps) {
  if (jobs.length === 0) return null;

  return (
    <section className={`export-batch-queue${enabled ? ' is-enabled' : ' is-bypassed'}`}>
      <div className="export-batch-toolbar">
        <button
          type="button"
          className={`export-batch-mode${enabled ? ' is-active' : ''}`}
          onClick={onToggleEnabled}
          disabled={isRunning}
          aria-pressed={enabled}
          title={enabled ? 'Bypass queue and export the active composition' : 'Use the media export queue'}
        >
          <span className="export-batch-mode-dot" />
          {enabled ? `Batch ${jobs.length}` : 'Composition'}
        </button>

        <div className="export-batch-toolbar-actions">
          <button
            type="button"
            className={`export-batch-shared${useSharedSettings ? ' is-active' : ''}`}
            onClick={onToggleSharedSettings}
            disabled={!enabled || isRunning}
            aria-pressed={useSharedSettings}
            title="Use the selected file's technical settings for every queued file"
          >
            All same
          </button>
          <button
            type="button"
            className="export-batch-clear"
            onClick={isRunning ? onCancel : onClear}
            title={isRunning ? 'Cancel the active batch export' : 'Remove all files from the batch queue'}
          >
            {isRunning ? 'Cancel' : 'Clear'}
          </button>
        </div>
      </div>

      <div
        className="export-batch-tabs"
        aria-label="Batch export files"
        aria-disabled={!enabled || useSharedSettings}
      >
        {jobs.map((job) => {
          const runtime = runtimeByJob[job.id];
          const selected = job.id === selectedJobId;
          const selectDisabled = !enabled || useSharedSettings || isRunning;
          return (
            <div
              key={job.id}
              className={`export-batch-tab${selected ? ' is-selected' : ''}${runtime ? ` is-${runtime.status}` : ''}`}
              title={runtime?.error ?? job.sourceName}
            >
              <button
                type="button"
                className="export-batch-tab-main"
                onClick={() => onSelectJob(job.id)}
                disabled={selectDisabled}
                aria-current={selected ? 'true' : undefined}
              >
                <span className="export-batch-tab-name">{job.sourceName}</span>
                <span className="export-batch-tab-status">{statusLabel(runtime)}</span>
              </button>
              <button
                type="button"
                className="export-batch-tab-remove"
                onClick={() => onRemoveJob(job.id)}
                disabled={isRunning}
                aria-label={`Remove ${job.sourceName}`}
                title={`Remove ${job.sourceName}`}
              >
                ×
              </button>
              {runtime?.status === 'encoding' && (
                <span className="export-batch-tab-progress" style={{ width: `${Math.max(0, Math.min(100, runtime.progress))}%` }} />
              )}
            </div>
          );
        })}
      </div>

      {!enabled && (
        <div className="export-batch-bypass-note">
          Queue bypassed — Export targets the active composition.
        </div>
      )}
      {enabled && useSharedSettings && (
        <div className="export-batch-shared-note">
          Shared settings are active. File names stay individual.
        </div>
      )}
    </section>
  );
}
