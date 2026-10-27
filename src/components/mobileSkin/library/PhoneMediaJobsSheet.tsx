// 'mediaJobs' sheet: the background jobs of the project's media (imports, proxies, waveforms,
// analysis, transcripts) with their state and progress, read live from the media store. Stop and Retry
// call the same commands as the Library item (the editor's proxy and waveform actions); Show opens
// the finished file in the source monitor. Nothing here edits the timeline.
import { useMemo, useState } from 'react';
import type { PhoneActionResult, PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { openPhoneSource } from '../source/phoneSourceCommands';
import { regeneratePhoneWaveform, togglePhoneProxyGeneration } from './phoneLibraryCommands';
import { phoneMediaJobs, type PhoneMediaJob, type PhoneMediaJobAction } from './phoneMediaJobs';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from './phoneListUi';
import { PHONE_MEDIA_JOBS_TEST_IDS } from './phoneLibraryTestIds';
import './PhoneLibrary.css';

const IDS = PHONE_MEDIA_JOBS_TEST_IDS;

const ACTION_LABEL: Record<PhoneMediaJobAction, string> = { stop: 'Stop', retry: 'Again', show: 'Show' };
const STATE_LABEL: Record<PhoneMediaJob['state'], string> = { waiting: 'Waiting', running: 'Running', failed: 'Failed', done: 'Done' };

async function runJobAction(job: PhoneMediaJob, action: PhoneMediaJobAction): Promise<PhoneActionResult> {
  if (action === 'show') {
    openPhoneSource(job.fileId);
    return { ok: true };
  }
  if (job.kind === 'proxy') return togglePhoneProxyGeneration(job.fileId);
  if (job.kind === 'waveform') return regeneratePhoneWaveform(job.fileId);
  return { ok: false, message: `${job.label} has no ${ACTION_LABEL[action]} command.` };
}

export const PhoneMediaJobsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const files = useMediaStore((state) => state.files);
  const [hideDone, setHideDone] = useState(false);
  const jobs = useMemo(() => phoneMediaJobs(files, { hideDone }), [files, hideDone]);
  const { status, report } = usePhoneStatus();

  return (
    <PhoneSheet title="Media jobs" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-lib" data-testid={IDS.root} onPointerUpCapture={blurTappedControl}>
        <PhoneStatusLine status={status} testId={IDS.status} />
        <button type="button" role="switch" className="phone-lib__chip" data-testid={IDS.hideDone} aria-checked={hideDone}
          aria-pressed={hideDone} onClick={() => setHideDone((value) => !value)}>
          Hide finished
        </button>
        {jobs.length === 0 ? (
          <p className="phone-lib__note" data-testid={IDS.empty}>
            {hideDone ? 'No job is running, waiting or failed.' : 'No media job yet. Imports, proxies, waveforms and analyses show up here.'}
          </p>
        ) : (
          <ul className="phone-lib__list phone-jobs">
            {jobs.map((job) => (
              <li key={job.id} className="phone-jobs__row" data-testid={IDS.row} data-job-kind={job.kind} data-job-state={job.state} data-file-id={job.fileId}>
                <div className="phone-jobs__text">
                  <strong>{job.label}</strong>
                  <span>{job.fileName}</span>
                  <small data-tone={job.state === 'failed' ? 'error' : 'info'}>
                    {STATE_LABEL[job.state]}{job.progress !== null ? ` · ${job.progress}%` : ''}{job.message ? ` · ${job.message}` : ''}
                  </small>
                  {job.progress !== null && (
                    <span className="phone-jobs__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress}>
                      <span style={{ width: `${job.progress}%` }} />
                    </span>
                  )}
                </div>
                <div className="phone-jobs__actions">
                  {job.actions.map((action) => (
                    <button key={action} type="button" className="phone-lib__chip" data-testid={IDS.action} data-action={action}
                      onClick={async () => { report(await runJobAction(job, action)); }}>
                      {ACTION_LABEL[action]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PhoneSheet>
  );
};
