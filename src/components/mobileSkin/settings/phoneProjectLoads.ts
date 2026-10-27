// "Recent project loads" of the phone Diagnostics page: the sanitized reports the project lifecycle
// keeps on window.__MS_PROJECT_LOAD__ (kind, outcome, storage, phase timings, first frame), as
// seconds per phase in plain words, newest first. Nothing here names the project.
import {
  readProjectLoadTimings,
  type ProjectLoadTiming,
} from '../../../services/project/load/projectLoadTelemetry';
import { REPOSITORY_LOAD_PHASES, type RepositoryLoadPhase } from '../../../services/project/repository/lifecycle/repositoryLoadTimings';

export const PHONE_LOAD_PHASE_LABELS: Record<RepositoryLoadPhase, string> = {
  queue: 'Waiting for earlier work',
  prepare: 'Checking the project',
  handoff: 'Handing over',
  target: 'Writing the new project',
  storage_open: 'Opening storage',
  session_read: 'Reading project',
  initialize: 'First revision',
  views: 'Writing workspace',
  workspace: 'Reading workspace',
  activation: 'Preparing editor',
  close_previous: 'Closing previous project',
  sync: 'Saving editor state',
  publish: 'Confirming on disk',
};

const KIND_LABELS: Record<ProjectLoadTiming['kind'], string> = {
  open: 'Open', create: 'Create', duplicate: 'Save as copy', scratch: 'Scratch open', save: 'Save',
};

const STORAGE_LABELS: Record<string, string> = {
  opfs: 'browser storage', indexeddb: 'browser storage (IndexedDB)', fsa: 'folder', native: 'native helper', unknown: 'unknown storage',
};

/** A phase or total this slow is highlighted. */
export const PHONE_SLOW_LOAD_MS = 5_000;

export interface PhoneLoadRow {
  key: string;
  title: string;
  outcome: string;
  total: string;
  slow: boolean;
  phases: Array<{ phase: RepositoryLoadPhase; label: string; seconds: string; slow: boolean }>;
  firstFrame: string | null;
  frameGap: string | null;
}

/** '0.42 s', '3.10 s', '31.2 s'. */
export function formatLoadSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.00 s';
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`;
}

export function describePhoneProjectLoads(timings: readonly ProjectLoadTiming[]): PhoneLoadRow[] {
  return timings.map((timing, index): PhoneLoadRow => {
    const phases = REPOSITORY_LOAD_PHASES
      .filter((phase) => typeof timing.phases[phase] === 'number')
      .map((phase) => {
        const ms = timing.phases[phase]!;
        return { phase, label: PHONE_LOAD_PHASE_LABELS[phase], seconds: formatLoadSeconds(ms), slow: ms >= PHONE_SLOW_LOAD_MS };
      });
    const frameGap = timing.mainThread?.frameGapMaxMs;
    return {
      key: `${index}-${timing.kind}-${Math.round(timing.totalMs)}`,
      title: `${KIND_LABELS[timing.kind] ?? timing.kind} · ${STORAGE_LABELS[timing.storage] ?? timing.storage}`,
      outcome: timing.outcome,
      total: formatLoadSeconds(timing.totalMs),
      slow: timing.totalMs >= PHONE_SLOW_LOAD_MS || (timing.firstFrameMs ?? 0) >= PHONE_SLOW_LOAD_MS,
      phases,
      firstFrame: typeof timing.firstFrameMs === 'number' ? formatLoadSeconds(timing.firstFrameMs) : null,
      frameGap: typeof frameGap === 'number' && frameGap >= 0 ? formatLoadSeconds(frameGap) : null,
    };
  }).reverse();
}

export function readPhoneProjectLoads(): PhoneLoadRow[] {
  return describePhoneProjectLoads(readProjectLoadTimings());
}

/** Plain-text lines for the copied diagnostics report. */
export function formatPhoneProjectLoads(rows: readonly PhoneLoadRow[]): string[] {
  if (rows.length === 0) return [];
  return ['Recent project loads:', ...rows.map((row) => {
    const parts = [`${row.title} ${row.outcome}: total ${row.total}`, ...row.phases.map((p) => `${p.phase} ${p.seconds}`)];
    if (row.firstFrame) parts.push(`first frame ${row.firstFrame}`);
    return `- ${parts.join(' · ')}`;
  })];
}
