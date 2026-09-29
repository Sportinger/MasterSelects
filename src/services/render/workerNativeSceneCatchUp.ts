/** Progress retained by the Worker after an exact frame's deadline elapsed. */
export interface WorkerNativeSceneCatchUp {
  readonly completedSteps: number;
}

export class WorkerNativeSceneDeadlineError extends Error {
  readonly completedSteps: number;
  constructor(completedSteps: number) {
    super('Native scene frame expired while preparing simulation');
    this.completedSteps = completedSteps;
  }
}

/** Replacement and disposal are terminal; only completed GPU work can resume. */
export class WorkerNativeSceneDeadline {
  private completedSteps = 0;
  private readonly expiresAt: number;
  private readonly clock: () => number;
  private readonly current: () => boolean;

  constructor(expiresAt: number, clock: () => number, current: () => boolean) {
    this.expiresAt = expiresAt;
    this.clock = clock;
    this.current = current;
  }

  assertCurrent = (): void => {
    if (!this.current()) throw new Error('Native scene target was replaced or disposed');
    if (this.clock() >= this.expiresAt) throw new WorkerNativeSceneDeadlineError(this.completedSteps);
  };

  completed(beforeStep: number, afterStep: number): void {
    // A backward seek or graph edit can reset the session before advancing.
    this.completedSteps += Math.max(0, afterStep < beforeStep ? afterStep : afterStep - beforeStep);
  }
}

export function canResumeWorkerNativeScene(
  progress: WorkerNativeSceneCatchUp | undefined,
  currentRequest: boolean,
): boolean {
  return currentRequest && !!progress && Number.isSafeInteger(progress.completedSteps) && progress.completedSteps > 0;
}
