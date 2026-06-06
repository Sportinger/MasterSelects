import type { ClipStemSeparationJobPhase } from '../types';

export const ACTIVE_STEM_JOB_PHASES = new Set<ClipStemSeparationJobPhase>([
  'queued',
  'preparing',
  'downloading-model',
  'loading-model',
  'separating',
  'storing',
]);

export function isActiveStemJobPhase(
  phase: ClipStemSeparationJobPhase | null | undefined,
): phase is ClipStemSeparationJobPhase {
  return !!phase && ACTIVE_STEM_JOB_PHASES.has(phase);
}

export function formatStemJobPhase(phase: string): string {
  switch (phase) {
    case 'queued':
      return 'Queued';
    case 'preparing':
      return 'Preparing audio';
    case 'downloading-model':
      return 'Downloading stem model';
    case 'loading-model':
      return 'Loading stem model';
    case 'separating':
      return 'Separating stems';
    case 'storing':
      return 'Storing stems';
    default:
      return 'Stem separation';
  }
}
