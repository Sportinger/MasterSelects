// Boot and problem status of the phone skin. While booting it fills the screen with progress;
// afterwards it shows storage, folder-permission and renderer problems as an actionable banner.
// It never leaves the page blank and never hides a failure silently.

import { useState } from 'react';
import { useEngineStore } from '../../../stores/engineStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneRuntime } from './PhoneRuntimeContext';

interface PhoneProblem {
  key: string;
  title: string;
  message: string;
  help?: string;
}

function reloadPage() {
  window.location.reload();
}

function usePhoneProblems(): PhoneProblem[] {
  const { status } = usePhoneRuntime();
  const setupAdvice = useEngineStore((s) => s.engineInitSetupAdvice);
  const problems: PhoneProblem[] = [];
  if (status.bootError) {
    problems.push({ key: `boot:${status.bootError}`, title: 'Project storage problem', message: status.bootError });
  }
  if (status.engineError) {
    problems.push({
      key: `engine:${status.engineError}`,
      title: 'Preview renderer is not working',
      message: status.engineError,
      help: setupAdvice
        ? 'Use a current Chrome, Edge or Safari with hardware acceleration turned on, then reload.'
        : 'The renderer stopped during this session. Reload to restart it.',
    });
  }
  if (status.permissionPending && status.projectOpen) {
    problems.push({
      key: 'permission',
      title: 'Folder access needed',
      message: 'Your last project is still waiting for folder access. Reload and choose Resume in the project list.',
    });
  }
  return problems;
}

function PhoneBootProgress() {
  const progress = useMediaStore((s) => s.projectLoadProgress);
  const percent = progress.active ? Math.max(0, Math.min(100, progress.percent)) : null;
  const message = progress.active && progress.message ? progress.message : 'Starting MasterSelects';
  return (
    <div className="phone-boot-status phone-boot-status--booting" data-testid={PHONE_TEST_IDS.bootStatus} role="status" aria-live="polite" data-state="booting">
      <div className="phone-boot-status__card">
        <p className="phone-boot-status__title">{message}</p>
        {progress.active && progress.detail && <p className="phone-boot-status__detail">{progress.detail}</p>}
        <div
          className="phone-boot-status__bar"
          role="progressbar"
          aria-label="Startup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={percent === null ? 'phone-boot-status__fill is-indeterminate' : 'phone-boot-status__fill'}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function PhoneBootStatus() {
  const { status } = usePhoneRuntime();
  const problems = usePhoneProblems();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  if (status.bootPending) return <PhoneBootProgress />;

  const visible = problems.filter((problem) => !dismissed.has(problem.key));
  if (visible.length === 0) return null;

  return (
    <div className="phone-boot-status phone-boot-status--problem" data-testid={PHONE_TEST_IDS.bootStatus} role="alert" aria-live="assertive" data-state="problem">
      {visible.map((problem) => (
        <div key={problem.key} className="phone-boot-status__card">
          <p className="phone-boot-status__title">{problem.title}</p>
          <p className="phone-boot-status__detail">{problem.message}</p>
          {problem.help && <p className="phone-boot-status__detail">{problem.help}</p>}
          <div className="phone-boot-status__actions">
            <button type="button" className="phone-boot-status__button is-primary" onClick={reloadPage}>
              Reload
            </button>
            <button
              type="button"
              className="phone-boot-status__button"
              onClick={() => setDismissed((current) => new Set(current).add(problem.key))}
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
