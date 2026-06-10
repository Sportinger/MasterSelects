import { useMediaStore, type ProjectLoadProgress } from '../../../stores/mediaStore';

type ProjectLoadProgressUpdate = Partial<Omit<ProjectLoadProgress, 'active'>> & {
  message: string;
};

const DEFAULT_PROJECT_LOAD_PROGRESS: ProjectLoadProgress = {
  active: false,
  phase: 'idle',
  percent: 0,
  message: '',
  blocking: false,
};

let projectLoadCompletionTimer: ReturnType<typeof setTimeout> | null = null;

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function setProjectLoadProgress(update: ProjectLoadProgressUpdate | null): void {
  if (projectLoadCompletionTimer) {
    clearTimeout(projectLoadCompletionTimer);
    projectLoadCompletionTimer = null;
  }

  if (!update) {
    useMediaStore.setState({ projectLoadProgress: DEFAULT_PROJECT_LOAD_PROGRESS });
    return;
  }

  useMediaStore.setState((state) => ({
    projectLoadProgress: {
      ...state.projectLoadProgress,
      active: true,
      phase: update.phase ?? state.projectLoadProgress.phase,
      percent: clampPercent(update.percent ?? state.projectLoadProgress.percent),
      message: update.message,
      detail: update.detail,
      itemsDone: update.itemsDone,
      itemsTotal: update.itemsTotal,
      blocking: update.blocking ?? state.projectLoadProgress.blocking,
    },
  }));
}

export function completeProjectLoadProgress(message = 'Project ready'): void {
  setProjectLoadProgress({
    phase: 'ready',
    percent: 100,
    message,
    blocking: false,
  });
  projectLoadCompletionTimer = setTimeout(() => {
    setProjectLoadProgress(null);
  }, 900);
}

export function failProjectLoadProgress(error: unknown): void {
  setProjectLoadProgress({
    phase: 'error',
    percent: 100,
    message: 'Project load failed',
    detail: error instanceof Error ? error.message : String(error),
    blocking: false,
  });
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
