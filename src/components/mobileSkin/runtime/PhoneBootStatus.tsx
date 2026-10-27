// Boot and problem status of the phone skin. While booting it shows the opaque loading view;
// afterwards it shows storage, folder-permission and renderer problems as an actionable banner.
// It never leaves the page blank and never hides a failure silently.

import { useState } from 'react';
import { useEngineStore } from '../../../stores/engineStore';
import { PHONE_TEST_IDS } from '../contracts';
import { usePhoneRuntime } from './PhoneRuntimeContext';
import { PhoneProjectLoadingView } from './PhoneProjectLoadingView';

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
      message: 'Your last project is still waiting for folder access. Open the projects home and tap Reopen to allow it.',
    });
  }
  return problems;
}

export function PhoneBootStatus() {
  const { status } = usePhoneRuntime();
  const problems = usePhoneProblems();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  // While booting, the opaque loading view shows the restore progress instead.
  if (status.bootPending) return <PhoneProjectLoadingView booting />;

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
