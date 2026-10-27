// Batch queue part of the export sheet: add project media as jobs, run them one after another,
// retry the failed ones, and save or share each finished file. Same queue as the desktop panel.
import type { BatchExportJob } from '../../../stores/exportStore';
import type { PhoneActionResult } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { savePhoneExport, sharePhoneExport } from './phoneExportDelivery';
import { releasePointerFocus } from './PhoneExportControls';
import { PHONE_EXPORT_TEST_IDS } from './phoneExportTestIds';
import { usePhoneExportBatch } from './usePhoneExportBatch';

const STATUS_LABELS: Record<string, string> = {
  queued: 'Waiting', resolving: 'Opening', encoding: 'Encoding', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled',
};

/** What a job writes, from its own settings (the project export settings when it was added). */
function describeJobOutput(job: BatchExportJob): string {
  const { settings } = job;
  if (job.mediaType === 'audio') return settings.audioOnlyFormat === 'browser' ? 'AAC/Opus' : settings.audioOnlyFormat.toUpperCase();
  const width = settings.useCustomResolution ? settings.customWidth : settings.width;
  const height = settings.useCustomResolution ? settings.customHeight : settings.height;
  const kind = job.mediaType === 'image' ? settings.imageFormat.toUpperCase() : `${settings.containerFormat.toUpperCase()} ${settings.videoCodec.toUpperCase()}`;
  return `${width} × ${height} ${kind}`;
}

export function PhoneExportBatch() {
  const batch = usePhoneExportBatch();
  const showToast = usePhoneUiStore((store) => store.showToast);
  const report = (result: PhoneActionResult) => showToast(result.message ?? (result.ok ? 'Done.' : 'Something went wrong.'), result.ok ? 'info' : 'error');
  const available = batch.sources.filter((source) => !source.queued);

  return (
    <div className="phone-export-batch" data-testid={PHONE_EXPORT_TEST_IDS.batch}>
      <p className="phone-export__hint">Convert project media files one by one with the project export settings.</p>
      {available.length > 0 ? (
        <div className="phone-export-group" role="group" aria-label="Add to the queue">
          <span className="phone-export-group__label">Add to the queue</span>
          <div className="phone-export-group__chips">
            {available.map((source) => (
              <button
                key={source.id}
                type="button"
                className="phone-export-chip"
                aria-disabled={batch.running}
                data-testid={PHONE_EXPORT_TEST_IDS.batchSource}
                data-media-id={source.id}
                onPointerUp={releasePointerFocus}
                onClick={() => {
                  if (batch.running) showToast('Wait until the queue has finished.', 'info');
                  else batch.addSource(source);
                }}
              >
                + {source.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="phone-export__hint">{batch.sources.length === 0 ? 'Import a video, sound or image first.' : 'Every media file is in the queue.'}</p>
      )}

      {batch.jobs.length > 0 ? (
        <ul className="phone-export-batch__jobs">
          {batch.jobs.map((job) => {
            const state = batch.runtime[job.id];
            const result = batch.results[job.id];
            return (
              <li key={job.id} className="phone-export-batch__job" data-testid={PHONE_EXPORT_TEST_IDS.batchJob} data-job-id={job.id} data-status={state?.status ?? 'idle'}>
                <div className="phone-export-batch__job-text">
                  <span className="phone-export-batch__job-name">{job.sourceName}</span>
                  <span className="phone-export-batch__job-status">
                    {describeJobOutput(job)} · {state ? `${STATUS_LABELS[state.status] ?? state.status}${state.status === 'encoding' ? ` ${Math.round(state.progress)}%` : ''}` : 'Ready'}
                    {state?.error ? ` · ${state.error}` : ''}
                  </span>
                </div>
                {result ? (
                  <>
                    <button type="button" className="phone-export__button" data-testid={PHONE_EXPORT_TEST_IDS.batchJobSave}
                      onPointerUp={releasePointerFocus} onClick={() => report(savePhoneExport(result.blob, result.filename))}>Save</button>
                    <button type="button" className="phone-export__button"
                      onPointerUp={releasePointerFocus}
                      onClick={() => { void sharePhoneExport(result.blob, result.filename, job.sourceName).then(report); }}>Share</button>
                  </>
                ) : (
                  <button type="button" className="phone-export__button" aria-disabled={batch.running} aria-label={`Remove ${job.sourceName}`}
                    data-testid={PHONE_EXPORT_TEST_IDS.batchJobRemove} onPointerUp={releasePointerFocus}
                    onClick={() => (batch.running ? showToast('Wait until the queue has finished.', 'info') : batch.removeJob(job.id))}>Remove</button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="phone-export__delivery">
        {batch.running ? (
          <button type="button" className="phone-export__button phone-export__button--danger" data-testid={PHONE_EXPORT_TEST_IDS.batchCancel}
            onPointerUp={releasePointerFocus} onClick={batch.cancel}>Cancel queue</button>
        ) : (
          <button type="button" className="phone-export__button phone-export__button--primary" aria-disabled={batch.jobs.length === 0}
            data-testid={PHONE_EXPORT_TEST_IDS.batchRun} onPointerUp={releasePointerFocus}
            onClick={() => (batch.jobs.length === 0 ? showToast('Add a media file to the queue first.', 'info') : void batch.runAll())}>
            Run queue
          </button>
        )}
        <button type="button" className="phone-export__button" aria-disabled={batch.running || batch.retryCount === 0}
          data-testid={PHONE_EXPORT_TEST_IDS.batchRetry} onPointerUp={releasePointerFocus}
          onClick={() => {
            if (batch.running) showToast('Wait until the queue has finished.', 'info');
            else if (batch.retryCount === 0) showToast('Nothing failed, so there is nothing to retry.', 'info');
            else void batch.retryFailed();
          }}>
          Retry failed{batch.retryCount > 0 ? ` (${batch.retryCount})` : ''}
        </button>
      </div>
      {batch.jobs.length > 0 && !batch.running ? (
        <button type="button" className="phone-export__link" data-testid={PHONE_EXPORT_TEST_IDS.batchClear}
          onPointerUp={releasePointerFocus} onClick={batch.clearJobs}>Clear the queue</button>
      ) : null}
    </div>
  );
}
