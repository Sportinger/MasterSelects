import type { LandingBackgroundStatus } from './runLandingBackgroundCreation';

interface LandingChatActivityProps {
  status: LandingBackgroundStatus;
}

function plainLabel(label: string): string {
  return label.trim().replace(/(?:\.\.\.|\u2026)$/u, '');
}

export function LandingChatActivity({ status }: LandingChatActivityProps) {
  const currentLabel = plainLabel(status.label);
  const recordedSteps = Array.isArray(status.steps) ? status.steps : [];
  const completedSteps = (
    recordedSteps.at(-1) === currentLabel ? recordedSteps.slice(0, -1) : recordedSteps
  ).slice(-3);

  return (
    <div className="landing-chat-activity" aria-live="polite" role="status">
      <span className="landing-chat-activity-dot" aria-hidden="true" />
      <span className="landing-chat-activity-copy">
        <strong>{status.label}</strong>
        {status.detail && <span>{status.detail}</span>}
        {completedSteps.length > 0 && (
          <span
            className="landing-chat-activity-trail"
            aria-label={`Completed steps: ${completedSteps.join(', ')}`}
          >
            {completedSteps.join(' / ')}
          </span>
        )}
      </span>
      {status.progress !== undefined && (
        <span className="landing-chat-activity-progress">
          {status.progress}%
        </span>
      )}
    </div>
  );
}
