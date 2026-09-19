import type { BatchExportJob } from '../../../stores/exportStore';
import {
  ExportInspectorNote,
  ExportInspectorRow,
  ExportInspectorSection,
  ExportInspectorToggle,
} from '../panel/ExportInspectorPrimitives';
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
    <ExportInspectorSection
      className="export-batch-section"
      defaultOpen={enabled}
      enabled={enabled}
      indicator={enabled ? 'active' : 'inactive'}
      onEnabledChange={isRunning ? undefined : onToggleEnabled}
      target="batch-section"
      title={`Batch Export · ${jobs.length}`}
    >
      <ExportInspectorRow label="Queue">
        <div className="export-batch-toolbar-actions">
          <ExportInspectorToggle
            checked={useSharedSettings}
            disabled={!enabled || isRunning}
            label="All same"
            onChange={onToggleSharedSettings}
          />
          <button
            className="export-inspector-action-button"
            onClick={isRunning ? onCancel : onClear}
            title={isRunning ? 'Cancel the active batch export' : 'Remove all files from the batch queue'}
            type="button"
          >
            {isRunning ? 'Cancel' : 'Clear'}
          </button>
        </div>
      </ExportInspectorRow>

      <div
        aria-disabled={!enabled || useSharedSettings}
        aria-label="Batch export files"
        className="export-batch-tabs"
      >
        {jobs.map(job => {
          const runtime = runtimeByJob[job.id];
          const selected = job.id === selectedJobId;
          const selectDisabled = !enabled || useSharedSettings || isRunning;
          return (
            <div
              className={`export-batch-tab${selected ? ' is-selected' : ''}${runtime ? ` is-${runtime.status}` : ''}`}
              key={job.id}
              title={runtime?.error ?? job.sourceName}
            >
              <button
                aria-current={selected ? 'true' : undefined}
                className="export-batch-tab-main"
                disabled={selectDisabled}
                onClick={() => onSelectJob(job.id)}
                type="button"
              >
                <span className="export-batch-tab-name">{job.sourceName}</span>
                <span className="export-batch-tab-status">{statusLabel(runtime)}</span>
              </button>
              <button
                aria-label={`Remove ${job.sourceName}`}
                className="export-batch-tab-remove"
                disabled={isRunning}
                onClick={() => onRemoveJob(job.id)}
                title={`Remove ${job.sourceName}`}
                type="button"
              >
                ×
              </button>
              {runtime?.status === 'encoding' && (
                <span
                  className="export-batch-tab-progress"
                  style={{ width: `${Math.max(0, Math.min(100, runtime.progress))}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {!enabled && <ExportInspectorNote>Queue bypassed — Export targets the active composition.</ExportInspectorNote>}
      {enabled && useSharedSettings && (
        <ExportInspectorNote>Shared settings are active. File names stay individual.</ExportInspectorNote>
      )}
    </ExportInspectorSection>
  );
}
