import { resetFlashBoardJournalMembership } from './editorFlashBoardJournal';
import { RepositoryError, type JsonValue } from '../contracts';
import type { RepositorySession } from '../RepositorySession';
import type { TransactionToken } from './ProjectTransactionCoordinator';
import type { StoreMutationBoundary } from './storeMutationBoundary';
import { installStoreMutationBoundary, getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';
import { prepareDomainMutation, finishDomainMutation, type PreparedDomainMutation } from './domainMutationAdapter';
import { prepareTimelineMutation } from './domainAdapters/timelineAdapter';
import { prepareMediaMutation } from './domainAdapters/mediaAdapter';
import { prepareOtherDomainMutation } from './domainAdapters/otherDomainsAdapter';
import type { TimelineStore } from '../../../../stores/timeline/types';
import type { MediaState } from '../../../../stores/mediaStore/types';
import { assertExclusiveTimelineMutationAllowed } from '../../../../stores/timeline/exclusiveMutationLease';
import { publishEditorContentProjection, readEditorContentPublication } from './editorPublication';
import { domainJson } from '../domains/jsonBoundary';
import { queueSourceIdentity } from '../artifacts/queueSourceIdentity';
import { getEditorGestureToken, installEditorGestureEvents } from './editorGestureOwnership';
import { canonicalJson } from '../segments/canonical';
import { projectTimelineMutationToComposition } from './editorCompositionProjection';
import { refreshEditorHistoryAvailability } from './editorHistory';
import { playheadState } from '../../../layerBuilder/PlayheadState';

interface RollbackMutation { domain: string; patch: Record<string, unknown>; }
interface ActionScope { token: TransactionToken | null; owns: boolean; label: string; domain: string; }
interface PreparedMutation { prepared: PreparedDomainMutation | null; scope: ActionScope; direct: boolean; plan: import('./domainMutationAdapter').DomainMutationPlan; }
interface EditorRuntime {
  session: RepositorySession | null; explicit: TransactionToken | null; scopes: ActionScope[];
  rollbacks: Map<symbol, RollbackMutation[]>; workspace: Record<string, unknown>;
  viewChain: Promise<void>; journalValues: Map<string, JsonValue>;
  sourceJobs: Map<string, { controller: AbortController; file: Blob; session: RepositorySession; complete?: boolean }>;
  sessionListeners: Set<() => void>;
  pendingViews: Map<string, JsonValue>; viewScheduled: boolean; viewError: unknown;
  viewWriting: boolean; workspaceTimer: ReturnType<typeof setInterval> | null;
  /** Modal multi-step operation whose awaited mutations publish as one revision. */
  batch?: TransactionToken | null;
}
const runtime: EditorRuntime = import.meta.hot?.data?.editorRepositoryRuntime ?? {
  session: null, explicit: null, scopes: [], rollbacks: new Map(), workspace: {}, viewChain: Promise.resolve(), journalValues: new Map(), sourceJobs: new Map(), sessionListeners: new Set(), pendingViews: new Map(), viewScheduled: false, viewError: null, viewWriting: false, workspaceTimer: null,
};
export function getEditorRepositorySession(): RepositorySession | null { return runtime.session; }
export function getEditorTransactionToken(): TransactionToken | null { return runtime.scopes.at(-1)?.token ?? runtime.explicit ?? getEditorGestureToken() ?? activeEditorBatch(); }
function activeEditorBatch(): TransactionToken | null { return runtime.batch && ownsEditorTransaction(runtime.batch) ? runtime.batch : null; }
export function subscribeEditorRepositorySession(listener: () => void): () => void { runtime.sessionListeners.add(listener); return () => runtime.sessionListeners.delete(listener); }
export function getEditorRepositoryWorkspace(): JsonValue { return domainJson(runtime.workspace); }
export function installEditorRepositorySession(session: RepositorySession, options: { workspace?: JsonValue } = {}): () => void {
  if (runtime.session && runtime.session !== session && runtime.rollbacks.size) throw new RepositoryError('ownership', 'Finish editor transactions before installing another project');
  if (sourceRetryTimer) clearTimeout(sourceRetryTimer); sourceRetryTimer = null;
  runtime.session = session; runtime.workspace = structuredClone(options.workspace ?? {}) as Record<string, unknown>;
  for (const job of runtime.sourceJobs.values()) job.controller.abort(); runtime.sourceJobs.clear();
  runtime.explicit = null; runtime.scopes = []; runtime.rollbacks.clear(); runtime.journalValues.clear(); resetFlashBoardJournalMembership();
  runtime.pendingViews.clear(); runtime.viewError = null;
  // An absent default view needs no write on every reopen. Later motion still publishes.
  const initialMedia = getRepositoryStore('media')?.getState() as MediaState | undefined;
  const initialTimeline = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
  if (initialMedia?.activeCompositionId && initialTimeline) {
    const key = `timeline/${initialMedia.activeCompositionId}/playheadPosition`;
    if (!(key in runtime.workspace)) runtime.workspace[key] = initialTimeline.playheadPosition;
  }
  if (runtime.workspaceTimer) clearInterval(runtime.workspaceTimer);
  runtime.workspaceTimer = setInterval(() => {
    if (runtime.session !== session || readEditorContentPublication().blocked) return;
    const media = getRepositoryStore('media')?.getState() as MediaState | undefined;
    const timeline = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
    if (media?.activeCompositionId && timeline) queueEditorRepositoryView(`timeline/${media.activeCompositionId}/playheadPosition`, playheadState.isUsingInternalPosition ? playheadState.position : timeline.playheadPosition);
  }, 1000);
  installStoreMutationBoundary(boundary);
  installEditorGestureEvents();
  scheduleEditorSourceIdentities();
  publishEditorContentProjection(session.coordinator.getStatus());
  for (const listener of runtime.sessionListeners) listener();
  void refreshEditorHistoryAvailability().catch(() => {});
  const unsubscribe = session.coordinator.subscribe(status => {
    if (runtime.session !== session || readEditorContentPublication().blocked) return;
    publishEditorContentProjection(status);
    void refreshEditorHistoryAvailability().catch(() => {});
  });
  return () => {
    unsubscribe();
    if (runtime.session !== session) return;
    if (runtime.rollbacks.size) throw new RepositoryError('ownership', 'Editor transaction remains open during session cleanup');
    if (sourceRetryTimer) clearTimeout(sourceRetryTimer); sourceRetryTimer = null;
    runtime.session = null; installStoreMutationBoundary(null);
    if (runtime.workspaceTimer) clearInterval(runtime.workspaceTimer); runtime.workspaceTimer = null;
    for (const job of runtime.sourceJobs.values()) job.controller.abort(); runtime.sourceJobs.clear();
    for (const listener of runtime.sessionListeners) listener();
  };
}
function session(): RepositorySession { if (!runtime.session) throw new RepositoryError('ownership', 'No editor repository session'); return runtime.session; }
export function beginEditorTransaction(label: string, source = 'user'): TransactionToken {
  const token = session().coordinator.begin(label, source); runtime.rollbacks.set(token.owner, []); return token;
}
export function ownsEditorTransaction(token: TransactionToken): boolean { return runtime.session?.coordinator.owns(token) === true; }
/** Authorization is deliberately synchronous. Awaited callbacks must re-enter with their pinned token. */
export function runEditorTransaction<T>(token: TransactionToken, action: () => T): T {
  if (!ownsEditorTransaction(token)) throw new RepositoryError('ownership', 'Editor transaction belongs to a stale project session');
  const prior = runtime.explicit; runtime.explicit = token;
  try { return action(); } finally { runtime.explicit = prior; }
}
export function commitEditorTransaction(token: TransactionToken): ReturnType<RepositorySession['coordinator']['commit']> {
  const result = session().coordinator.commit(token); runtime.rollbacks.delete(token.owner);
  publishEditorContentProjection(session().coordinator.getStatus()); return result;
}
/**
 * Runs a modal multi-step operation (e.g. relinking hundreds of files) as one undoable revision and one save.
 * Mutations captured while it runs join it even across awaits; nested batches join the outer one.
 */
export async function runEditorBatch<T>(label: string, action: () => Promise<T>): Promise<T> {
  if (!runtime.session || activeEditorBatch()) return action();
  const token = beginEditorTransaction(label, 'user'); runtime.batch = token;
  try {
    const value = await action();
    if (runtime.batch === token) runtime.batch = null;
    if (ownsEditorTransaction(token)) commitEditorTransaction(token);
    return value;
  } catch (error) {
    if (runtime.batch === token) runtime.batch = null;
    if (ownsEditorTransaction(token)) cancelEditorTransaction(token);
    throw error;
  }
}
export function cancelEditorTransaction(token: TransactionToken): void {
  session().coordinator.cancel(token);
  const mutations = runtime.rollbacks.get(token.owner) ?? [];
  const timelineBefore = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
  withRepositoryHydration(() => {
    for (const mutation of mutations.toReversed()) getRepositoryStore(mutation.domain)?.setState(mutation.patch);
  });
  const restored = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
  if (timelineBefore && restored && mutations.some(mutation => mutation.domain === 'timeline')) projectTimelineMutationToComposition(timelineBefore, restored);
  runtime.rollbacks.delete(token.owner); publishEditorContentProjection(session().coordinator.getStatus());
}
function beginScope(domain: string, label: string): ActionScope {
  const parent = runtime.scopes.at(-1)?.token ?? runtime.explicit ?? getEditorGestureToken();
  return { token: parent, owns: false, label, domain };
}
function ensureScopeToken(scope: ActionScope): TransactionToken {
  if (scope.token) return scope.token;
  const outer = runtime.scopes[0] ?? scope;
  if (!outer.token) { outer.token = beginEditorTransaction(outer.label, outer.domain); outer.owns = true; }
  scope.token = outer.token; return outer.token;
}
function endScope(scope: ActionScope, error?: unknown): void {
  if (!scope.owns || !scope.token) return;
  if (error) cancelEditorTransaction(scope.token); else {
    try { commitEditorTransaction(scope.token); }
    catch (failure) { if (ownsEditorTransaction(scope.token)) cancelEditorTransaction(scope.token); throw failure; }
  }
}
const boundary: StoreMutationBoundary = {
  assertAllowed() {
    assertExclusiveTimelineMutationAllowed();
    if (readEditorContentPublication().blocked) throw new RepositoryError('ownership', 'Editor content projection is being activated');
  },
  beginAction(domain, label) { const scope = beginScope(domain, label); runtime.scopes.push(scope); return scope; },
  prepare(domain, before, patch, replacing) {
    const current = session(), entities = current.coordinator.getEntities();
    const changes = replacing ? patch : patch;
    const plan = domain === 'timeline' ? prepareTimelineMutation(before as TimelineStore, changes as Partial<TimelineStore>, {
      entities, activeComposition: (getRepositoryStore('media')?.getState() as MediaState | undefined)?.compositions.find(comp => comp.id === (getRepositoryStore('media')?.getState() as MediaState).activeCompositionId),
    }) : domain === 'media' ? prepareMediaMutation(before as MediaState, changes as Partial<MediaState>, entities)
      : prepareOtherDomainMutation(domain, before, changes, entities);
    const existing = runtime.scopes.at(-1);
    const scope = existing ?? beginScope(domain, `Modify ${domain}`);
    const hasContent = plan.aggregates.some(aggregate => {
      for (const key of new Set([...aggregate.before.keys(), ...aggregate.after.keys()])) {
        if (canonicalJson(aggregate.before.get(key) ?? null) !== canonicalJson(aggregate.after.get(key) ?? null)) return true;
      }
      return false;
    });
    if (hasContent) boundary.assertAllowed(domain);
    let prepared: PreparedDomainMutation | null = null;
    try { prepared = hasContent ? prepareDomainMutation(current.coordinator, ensureScopeToken(scope), plan) : null; }
    catch (error) {
      const owner = scope.owns ? scope : runtime.scopes.find(candidate => candidate.owns && candidate.token === scope.token);
      if (owner?.token && ownsEditorTransaction(owner.token)) cancelEditorTransaction(owner.token);
      if (owner) {
        const abandoned = owner.token;
        for (const candidate of [...runtime.scopes, scope]) if (candidate.token === abandoned) { candidate.owns = false; candidate.token = null; }
      }
      throw error;
    }
    // Shallow field ownership is enough for runtime rollback: immutable setters retain old handles.
    const old = before as Record<string, unknown>, changed = patch as Record<string, unknown>;
    const rollback = Object.fromEntries(Object.keys(changed).filter(key => old[key] !== changed[key]).map(key => [key, old[key]]));
    if (scope.token) runtime.rollbacks.get(scope.token.owner)?.push({ domain, patch: rollback });
    return { prepared, scope, direct: !existing, plan, before };
  },
  finish(_domain, value, after) {
    const preparation = value as PreparedMutation & { before: unknown };
    if (preparation.prepared) finishDomainMutation(session().coordinator, preparation.prepared);
    if (_domain === 'timeline' && preparation.prepared) projectTimelineMutationToComposition(preparation.before as TimelineStore, after as TimelineStore);
    for (const { id, value } of preparation.plan.journals) {
      if (JSON.stringify(runtime.journalValues.get(id)) === JSON.stringify(value)) continue;
      runtime.journalValues.set(id, structuredClone(value)); session().coordinator.appendJournal(id, value);
    }
    for (const view of preparation.plan.views) {
      queueEditorRepositoryView(view.key, view.value);
    }
    if (preparation.direct) endScope(preparation.scope);
    if (_domain === 'media') scheduleEditorSourceIdentities();
  },
  failed(_domain, value) {
    const preparation = value as PreparedMutation | undefined;
    if (preparation?.direct && preparation.scope.token && ownsEditorTransaction(preparation.scope.token)) cancelEditorTransaction(preparation.scope.token);
  },
  endAction(value, error) {
    const scope = value as ActionScope;
    if (runtime.scopes.at(-1) !== scope) throw new RepositoryError('ownership', 'Editor action scope stack was corrupted');
    runtime.scopes.pop(); endScope(scope, error);
  },
};
export function queueEditorRepositoryView(key: string, value: JsonValue): void {
  if (!runtime.session) return;
  if (key in runtime.workspace && canonicalJson(runtime.workspace[key] as JsonValue) === canonicalJson(value)) return;
  if (!runtime.session.opening.writable) { runtime.workspace[key] = structuredClone(value); return; }
  if (!runtime.pendingViews.has(key) && runtime.pendingViews.size >= 256) throw new RepositoryError('budget', 'Too many pending editor view areas');
  runtime.workspace[key] = structuredClone(value); runtime.pendingViews.set(key, value);
  if (runtime.viewScheduled) return;
  runtime.viewScheduled = true; queueMicrotask(drainViews);
}
function drainViews(): void {
  runtime.viewScheduled = false;
  if (runtime.viewWriting) return;
  const pinned = runtime.session;
  const views = [...runtime.pendingViews]; runtime.pendingViews.clear();
  if (!pinned || !views.length) return;
  runtime.viewWriting = true;
  runtime.viewChain = runtime.viewChain.then(async () => {
    for (const [key, value] of views) {
      if (runtime.session !== pinned) throw new RepositoryError('ownership', 'View publication crossed a project session switch');
      await pinned.updateView(key, value);
    }
  }).catch(error => { runtime.viewError = error; for (const [key, value] of views) if (!runtime.pendingViews.has(key)) runtime.pendingViews.set(key, value); })
    .finally(() => { runtime.viewWriting = false; if (!runtime.viewError && runtime.pendingViews.size) drainViews(); });
}
export async function flushEditorRepositoryViews(): Promise<void> {
  drainViews(); await runtime.viewChain;
  if (runtime.pendingViews.size) { runtime.viewError = null; drainViews(); await runtime.viewChain; }
  while (runtime.viewWriting) await runtime.viewChain;
  if (runtime.viewError) throw runtime.viewError;
}
let sourceRetryDelay = 2000;
let sourceRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSourceRetry(): void {
  if (sourceRetryTimer || !runtime.session) return;
  const pinned = runtime.session;
  sourceRetryTimer = setTimeout(() => { sourceRetryTimer = null; if (runtime.session === pinned) scheduleEditorSourceIdentities(); }, sourceRetryDelay);
  sourceRetryDelay = Math.min(sourceRetryDelay * 2, 30000);
}
export function scheduleEditorSourceIdentities(): void {
  const pinned = runtime.session; if (!pinned) return;
  if (!pinned.opening.writable) return;
  if (readEditorContentPublication().blocked) { scheduleSourceRetry(); return; }
  const state = getRepositoryStore('media')?.getState() as MediaState | undefined;
  for (const [id, job] of runtime.sourceJobs) {
    if (job.session !== pinned || state?.files.find(file => file.id === id)?.file !== job.file) { job.controller.abort(); runtime.sourceJobs.delete(id); }
  }
  for (const file of state?.files ?? []) {
    const verified = pinned.coordinator.getEntities().get(`source-identity:${file.id}`)?.value as { identityStatus?: string; byteLength?: number } | undefined;
    const priorJob = runtime.sourceJobs.get(file.id);
    if (verified?.identityStatus === 'verified' && priorJob?.complete && priorJob.file === file.file) continue;
    // A stored full hash stays valid for a source that restore matched by size and fingerprint (a relink
    // clears it). Hashing every original again after each reload reread whole libraries for hours.
    if (verified?.identityStatus === 'verified' && file.file instanceof Blob && verified.byteLength === file.file.size && priorJob?.file !== file.file) {
      priorJob?.controller.abort();
      runtime.sourceJobs.set(file.id, { controller: new AbortController(), file: file.file, session: pinned, complete: true });
      continue;
    }
    if (priorJob?.complete) runtime.sourceJobs.delete(file.id);
    if ([...runtime.sourceJobs.values()].filter(job => !job.complete).length >= 32) { scheduleSourceRetry(); break; }
    if (!(file.file instanceof Blob) || file.file.size === 0 || runtime.sourceJobs.get(file.id)?.file === file.file) continue;
    const controller = new AbortController(), blob = file.file;
    runtime.sourceJobs.set(file.id, { controller, file: blob, session: pinned });
    const isCurrent = () => runtime.session === pinned && !controller.signal.aborted &&
      (getRepositoryStore('media')?.getState() as MediaState | undefined)?.files.find(item => item.id === file.id)?.file === blob;
    // Failure remains explicit in source identity (unverified); a job may never borrow a fast fingerprint.
    void queueSourceIdentity(pinned, file.id, blob, isCurrent, controller.signal).then(identity => {
      if (identity) { sourceRetryDelay = 2000; const job = runtime.sourceJobs.get(file.id); if (job?.controller === controller) job.complete = true; scheduleSourceRetry(); return; }
      if (runtime.sourceJobs.get(file.id)?.controller === controller) runtime.sourceJobs.delete(file.id);
      if (runtime.session === pinned && !controller.signal.aborted) scheduleSourceRetry();
    }).catch(() => {
      if (runtime.sourceJobs.get(file.id)?.controller === controller) runtime.sourceJobs.delete(file.id);
      if (runtime.session === pinned && !controller.signal.aborted) scheduleSourceRetry();
    });
  }
}
export function readEditorJournal(id: string): JsonValue | null { return runtime.journalValues.get(id) ?? null; }
export function bindEditorSourceJob(sourceId: string, sourceVersion: string, readVersion?: () => string | null): {
  repositoryId: string; sessionEpoch: string; isCurrent(): boolean; run<T>(action: () => T): T;
} {
  const pinned = session();
  const version = readVersion ?? (() => {
    const id = sourceId.startsWith('media:') ? sourceId.slice(6) : sourceId;
    const identity = pinned.coordinator.getEntities().get(`source-identity:${id}`)?.value as { identityStatus?: string; contentHash?: string } | undefined;
    return identity?.identityStatus === 'verified' && identity.contentHash ? `sha256:${identity.contentHash.replace(/^sha256:/u, '')}` : null;
  });
  const isCurrent = () => runtime.session === pinned && pinned.coordinator.sessionEpoch === epoch && version() === sourceVersion;
  const epoch = pinned.coordinator.sessionEpoch;
  return { repositoryId: pinned.descriptor.repositoryId, sessionEpoch: epoch, isCurrent,
    run(action) {
      if (!isCurrent()) throw new RepositoryError('ownership', `Source job ${sourceId} belongs to an obsolete source or project session`);
      const token = beginEditorTransaction(`Complete ${sourceId}`, 'background');
      try { const result = runEditorTransaction(token, action); commitEditorTransaction(token); return result; }
      catch (error) { if (ownsEditorTransaction(token)) cancelEditorTransaction(token); throw error; }
    } };
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.editorRepositoryRuntime = runtime; }); import.meta.hot.accept();
}
