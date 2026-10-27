// Opaque full-screen loading view of the phone: shown while the phone boots, creates, opens,
// reopens or imports a project, and while any other blocking project load runs. It names the
// project, says the current step in plain words, shows a progress bar and, after 5 s, the elapsed
// time. Nothing of the editor shows through it.
import { useEffect, useState } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { PHONE_TEST_IDS } from '../contracts';
import {
  PHONE_LOAD_STEP_LABELS,
  formatPhoneLoadElapsed,
  phoneLoadStep,
  phoneLoadTitle,
  usePhoneProjectOperationStore,
} from './phoneProjectOperation';
import { PHONE_PROJECT_LOADING_TEST_ID } from './phoneProjectLoadingTestIds';
import './PhoneProjectLoading.css';


interface PhoneProjectLoadingViewProps {
  /** The phone is still restoring its last project. */
  booting: boolean;
  /**
   * Also cover blocking loads the phone did not start (an open through the assistant or bridge).
   * Off while the home shows: there the editor's background scratch open reports blocking progress
   * that must not hide the project list.
   */
  coverOtherLoads?: boolean;
}

/** Milliseconds since `startedAt`, or since this view appeared; ticks once a second. */
function useElapsed(startedAt: number | null): number {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(mountedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, now - (startedAt ?? mountedAt));
}

export function PhoneProjectLoadingView({ booting, coverOtherLoads = true }: PhoneProjectLoadingViewProps) {
  const operation = usePhoneProjectOperationStore((state) => state.operation);
  const progress = useMediaStore((state) => state.projectLoadProgress);
  const blockingLoad = progress.active && progress.blocking === true && progress.phase !== 'ready' && progress.phase !== 'error';
  if (!booting && operation === null && !(coverOtherLoads && blockingLoad)) return null;
  // Mounted only while visible, so its clock starts when the view appears.
  return <PhoneProjectLoadingContent booting={booting} />;
}

function PhoneProjectLoadingContent({ booting }: PhoneProjectLoadingViewProps) {
  const operation = usePhoneProjectOperationStore((state) => state.operation);
  const progress = useMediaStore((state) => state.projectLoadProgress);
  const elapsed = formatPhoneLoadElapsed(useElapsed(operation?.startedAt ?? null));
  const step = phoneLoadStep(operation?.kind ?? null, progress);
  const percent = progress.active && progress.phase !== 'idle' ? Math.max(0, Math.min(100, progress.percent)) : null;
  const detail = progress.active && progress.detail ? progress.detail : null;

  return (
    <div
      className="phone-loading"
      data-testid={booting ? PHONE_TEST_IDS.bootStatus : PHONE_PROJECT_LOADING_TEST_ID}
      data-state={booting ? 'booting' : 'loading'}
      data-step={step}
      data-kind={operation?.kind ?? 'restore'}
      role="status"
      aria-live="polite"
    >
      <div className="phone-loading__inner">
        <p className="phone-loading__brand">MasterSelects</p>
        <h1 className="phone-loading__title">{booting && !operation ? 'Starting MasterSelects' : phoneLoadTitle(operation)}</h1>
        <p className="phone-loading__step" data-testid={`${PHONE_PROJECT_LOADING_TEST_ID}-step`}>{PHONE_LOAD_STEP_LABELS[step]}</p>
        <div
          className="phone-loading__bar"
          role="progressbar"
          aria-label={PHONE_LOAD_STEP_LABELS[step]}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={percent === null ? 'phone-loading__fill is-indeterminate' : 'phone-loading__fill'}
            style={percent === null ? undefined : { width: `${Math.max(4, percent)}%` }}
          />
        </div>
        <p className="phone-loading__meta">
          {detail ? <span className="phone-loading__detail">{detail}</span> : null}
          {elapsed ? <span data-testid={`${PHONE_PROJECT_LOADING_TEST_ID}-elapsed`}>{elapsed}</span> : null}
        </p>
      </div>
    </div>
  );
}
