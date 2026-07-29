/**
 * Local progress reporting for a kernel run.
 *
 * A kernel turn can take minutes (the Pages proxy allows up to 240s for a
 * story compile), and the chat used to show a single static "MS thinking…"
 * for the whole time. The gateway always knew exactly where it was; it just
 * never said so. These are the phases it can report without any server or
 * proxy change — the compile interior still arrives as one opaque `compiling`
 * step until the activity stream is scoped per run and proxied.
 */

export type KernelProgressStage =
  | 'reading-timeline'
  | 'reading-transcript'
  | 'reading-audio'
  | 'preparing-evidence'
  | 'compiling'
  | 'preparing'
  | 'executing'
  | 'verifying'
  | 'committing'
  | 'rolling-back';

export interface KernelProgressEvent {
  stage: KernelProgressStage;
  /** Short user-facing label for the stage. */
  label: string;
  /** Optional extra context, e.g. the tool being executed. */
  detail?: string;
  /** 1-based position when the stage iterates, e.g. call 7 of 24. */
  current?: number;
  total?: number;
}

export type KernelProgressReporter = (event: KernelProgressEvent) => void;

const STAGE_LABELS: Record<KernelProgressStage, string> = {
  'reading-timeline': 'Reading timeline',
  'reading-transcript': 'Reading transcript',
  'reading-audio': 'Analysing audio',
  'preparing-evidence': 'Preparing footage',
  compiling: 'Planning the edit',
  preparing: 'Preparing composition',
  executing: 'Applying edit',
  verifying: 'Verifying result',
  committing: 'Committing',
  'rolling-back': 'Rolling back',
};

export function kernelProgressLabel(stage: KernelProgressStage): string {
  return STAGE_LABELS[stage];
}

/** Ordered stages, used by the UI to render a rail with upcoming steps. */
export const KERNEL_PROGRESS_ORDER: KernelProgressStage[] = [
  'reading-timeline',
  'reading-transcript',
  'reading-audio',
  'preparing-evidence',
  'compiling',
  'preparing',
  'executing',
  'verifying',
  'committing',
];

export function createKernelProgressEvent(
  stage: KernelProgressStage,
  options: { detail?: string; current?: number; total?: number } = {},
): KernelProgressEvent {
  return {
    stage,
    label: STAGE_LABELS[stage],
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.current === undefined ? {} : { current: options.current }),
    ...(options.total === undefined ? {} : { total: options.total }),
  };
}
