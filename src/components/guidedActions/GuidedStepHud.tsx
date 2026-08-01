import type { GuidedScheduledAction, GuidedSessionSnapshot } from '../../services/guidedActions';

interface GuidedStepHudProps {
  currentStep: GuidedScheduledAction | null;
  embedded?: boolean;
  session: GuidedSessionSnapshot;
}

export function GuidedStepHud({ currentStep, embedded = false, session }: GuidedStepHudProps) {
  const tutorialSteps = readTutorialSteps(session.metadata?.tutorialSteps);
  const explicitProgress = readTutorialProgress(session.metadata?.tutorialProgress);
  const tutorialStepIndex = explicitProgress
    ? explicitProgress.current - 1
    : currentStep
    ? tutorialSteps.findIndex((step) => (
        currentStep.index >= step.startActionIndex && currentStep.index <= step.endActionIndex
      ))
    : tutorialSteps.length - 1;
  const hasTutorialProgress = explicitProgress !== null
    || (tutorialSteps.length > 0 && tutorialStepIndex >= 0);
  const total = explicitProgress?.total
    ?? (hasTutorialProgress ? tutorialSteps.length : session.plan.actions.length);
  const current = explicitProgress?.current ?? (hasTutorialProgress
    ? tutorialStepIndex + 1
    : currentStep
      ? currentStep.index + 1
      : total);
  const label = explicitProgress?.stepTitle ?? (hasTutorialProgress
    ? tutorialSteps[tutorialStepIndex]!.title
    : currentStep?.action.label ?? currentStep?.family ?? session.label ?? session.context.playbackMode);
  const sessionTitle = hasTutorialProgress
    ? session.label?.replace(/^Tutorial:\s*/, '')
    : null;
  const progress = total > 0 ? Math.min(100, Math.max(0, current / total * 100)) : 0;

  return (
    <div className={`guided-step-hud ${embedded ? 'guided-step-hud--embedded' : ''}`} role="status">
      <span className="guided-step-hud-copy">
        {sessionTitle && <span className="guided-step-hud-session">{sessionTitle}</span>}
        <span className="guided-step-hud-label">{label}</span>
      </span>
      <span className="guided-step-hud-count">
        {hasTutorialProgress ? 'Step ' : ''}{Math.min(current, total)} / {total}
      </span>
      {hasTutorialProgress && (
        <span className="guided-step-hud-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </span>
      )}
    </div>
  );
}

interface TutorialStepMetadata {
  endActionIndex: number;
  startActionIndex: number;
  title: string;
}

interface TutorialProgressMetadata {
  current: number;
  stepTitle: string;
  total: number;
}

function readTutorialProgress(value: unknown): TutorialProgressMetadata | null {
  if (typeof value !== 'object' || value === null) return null;
  const progress = value as Partial<TutorialProgressMetadata>;
  if (
    !Number.isInteger(progress.current)
    || !Number.isInteger(progress.total)
    || typeof progress.stepTitle !== 'string'
    || (progress.current ?? 0) < 1
    || (progress.total ?? 0) < (progress.current ?? 0)
  ) {
    return null;
  }
  return progress as TutorialProgressMetadata;
}

function readTutorialSteps(value: unknown): TutorialStepMetadata[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is TutorialStepMetadata => (
    typeof entry === 'object'
    && entry !== null
    && typeof (entry as TutorialStepMetadata).title === 'string'
    && Number.isInteger((entry as TutorialStepMetadata).startActionIndex)
    && Number.isInteger((entry as TutorialStepMetadata).endActionIndex)
  ));
}
