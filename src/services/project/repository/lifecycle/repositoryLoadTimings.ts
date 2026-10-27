// Phase timings of one repository open, create, duplicate, scratch open or explicit save.
// The lifecycle enters phases in order; time spent in a phase that is entered again adds up.
// Pure bookkeeping: what to report and where (analytics, logs) is the editor's decision.
//
// A report holds no runtime handle and nothing that names the project: the location is reduced to
// its storage kind when it is noted, so a folder handle or an OPFS path (which can contain the
// project name) never reaches the report, the window.__MS_PROJECT_LOAD__ list or analytics.

import type { RepositoryLocation } from '../storageWorkerProtocol';
import { resolveBrowserStore } from '../../core/browserStorageRoot';

export const REPOSITORY_LOAD_PHASES = [
  /** Waiting behind earlier lifecycle work (a background scratch open, a save, a close). */
  'queue',
  /** Source checks before anything is switched: descriptor read, legacy import, archive restore. */
  'prepare',
  /** Capturing the previous project's state and taking the editor barrier. */
  'handoff',
  /** Writing the new target (descriptor of a new project, the full copy of a Save As). */
  'target',
  /** Storage worker start, writer lock and history recovery, up to "Reading saved project". */
  'storage_open',
  /** Navigation, projection and reference reads of an existing project. */
  'session_read',
  /** First revision of a new project. */
  'initialize',
  /** Workspace views of a new project, and the confirmation of everything written. */
  'views',
  /** Reading the saved workspace views back. */
  'workspace',
  /** Store activation of the editor ("Restoring editor"). */
  'activation',
  /** Closing the previous project after the new one is active (not visible to the user). */
  'close_previous',
  /** Explicit save: editor stores and views written into the repository. */
  'sync',
  /** Explicit save: waiting until every accepted change is confirmed on disk. */
  'publish',
] as const;

export type RepositoryLoadPhase = typeof REPOSITORY_LOAD_PHASES[number];
export type RepositoryLoadKind = 'open' | 'create' | 'duplicate' | 'scratch' | 'save';
export type RepositoryLoadOutcome = 'ready' | 'failed' | 'cancelled' | 'superseded';
export type RepositoryLoadStorage = 'opfs' | 'indexeddb' | 'fsa' | 'native' | 'unknown';

/** The storage kind of a location; browser storage resolves to OPFS or the IndexedDB fallback. */
export function repositoryLoadStorage(location: RepositoryLocation | null | undefined): RepositoryLoadStorage {
  if (!location) return 'unknown';
  if (location.kind === 'opfs') return resolveBrowserStore(location.store) ?? 'opfs';
  return location.kind;
}

export interface RepositoryLoadReport {
  kind: RepositoryLoadKind;
  outcome: RepositoryLoadOutcome;
  totalMs: number;
  phases: Partial<Record<RepositoryLoadPhase, number>>;
  storage: RepositoryLoadStorage;
  writable?: boolean;
  recoveredRecords?: number;
}

export class RepositoryLoadTimer {
  readonly kind: RepositoryLoadKind;
  private readonly now: () => number;
  private readonly started: number;
  private current: RepositoryLoadPhase | null = null;
  private currentStarted = 0;
  private readonly phases: Partial<Record<RepositoryLoadPhase, number>> = {};
  private finished = false;
  private storage: RepositoryLoadStorage = 'unknown';
  writable?: boolean;
  recoveredRecords?: number;
  constructor(kind: RepositoryLoadKind, now: () => number = () => performance.now()) {
    this.kind = kind; this.now = now; this.started = now();
  }
  /** Ends the running phase and starts `phase`. */
  enter(phase: RepositoryLoadPhase): void {
    if (this.finished || this.current === phase) return;
    this.end(); this.current = phase; this.currentStarted = this.now();
  }
  /** Ends the running phase without starting another one. */
  end(): void {
    if (this.current === null) return;
    this.phases[this.current] = (this.phases[this.current] ?? 0) + Math.max(0, this.now() - this.currentStarted);
    this.current = null;
  }
  /** Notes where the repository lives; only its storage kind is kept. */
  noteLocation(location: RepositoryLocation): void { this.storage = repositoryLoadStorage(location); }
  noteRecords(count: number | undefined): void {
    if (typeof count === 'number' && Number.isFinite(count)) this.recoveredRecords = Math.max(this.recoveredRecords ?? 0, count);
  }
  /** Closes the measurement once; later calls return null. */
  finish(outcome: RepositoryLoadOutcome): RepositoryLoadReport | null {
    if (this.finished) return null;
    this.end(); this.finished = true;
    return { kind: this.kind, outcome, totalMs: Math.max(0, this.now() - this.started), phases: { ...this.phases }, storage: this.storage,
      ...(this.writable !== undefined ? { writable: this.writable } : {}),
      ...(this.recoveredRecords !== undefined ? { recoveredRecords: this.recoveredRecords } : {}) };
  }
}
