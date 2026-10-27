import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../../src/services/project/repository/contracts';
import type { ProjectFile } from '../../src/services/project/types/project.types';

/**
 * Operation budget of FOLDER projects (File System Access backend).
 *
 * On Android Chrome a project folder is an Android SAF document provider: every handle call is an IPC
 * round trip of 20-100+ ms instead of ~1 ms on desktop, so the NUMBER of strictly sequential folder
 * operations decides how long "Reading saved project" stays on screen. This harness runs the real
 * main-thread preparation, the real RepositoryLifecycle/RepositorySession and the real project storage
 * worker (loaded in-process) against an in-memory FileSystemDirectoryHandle that counts every call.
 *
 * Critical path: operations are released in rounds. A round releases every operation that is waiting
 * once the code has gone quiet, i.e. the operations that could run in parallel. The number of rounds
 * until the editor is usable is the length of the strictly sequential chain; at 50 ms per operation the
 * simulated time is rounds x 50 ms (computation in between is treated as free).
 *
 * The expectations are the CURRENT baseline (upper bounds). Lower them when an optimization lands.
 * FOLDER_BUDGET_REPORT=/abs/report.txt writes the per-scenario table and the ranked call sites
 * (FOLDER_BUDGET_OPS=1 adds every operation with its call chain).
 */

const harness = vi.hoisted(() => ({
  metadata: new Map<string, unknown>(),
  revisions: new Map<string, unknown>(),
  indexOps: 0,
}));
// Location registry, identity attestation and metadata index are IndexedDB (not the folder): in memory here.
vi.mock('../../src/services/project/repository/backends/browserOwner', async original => ({
  ...(await original<typeof import('../../src/services/project/repository/backends/browserOwner')>()),
  registerFsaLocation: async () => 'fsa:operation-budget-folder',
}));
vi.mock('../../src/services/project/repository/backends/repositoryLocationIdentity', async original => ({
  ...(await original<typeof import('../../src/services/project/repository/backends/repositoryLocationIdentity')>()),
  attestWritableRepositoryLocation: async () => 'same-location',
}));
vi.mock('../../src/services/project/repository/index/IndexedDBMetadataIndex', () => {
  const tick = <T>(value: T) => { harness.indexOps++; return Promise.resolve(value); };
  const index = {
    putRevision: (revision: { revisionId: string }) => tick(void harness.revisions.set(revision.revisionId, revision)),
    getRevision: (id: string) => tick(harness.revisions.get(id) ?? null),
    queryRevisions: () => tick({ items: [], nextCursor: null }),
    queryMetadata: () => tick({ items: [], nextCursor: null }),
    putMetadata: (key: string, value: unknown) => tick(void harness.metadata.set(key, value)),
    removeMetadata: (key: string) => tick(void harness.metadata.delete(key)),
    getMetadata: (key: string) => tick(harness.metadata.get(key) ?? null),
    clear: () => tick(undefined), close() {},
  };
  return { IndexedDBMetadataIndex: { open: async () => index } };
});

import { RepositoryLifecycle, type PreparedRepository } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
import { isLegacyProjectLocation, prepareNewRepository, prepareRepositoryOpen } from '../../src/services/project/repository/lifecycle/repositoryLocations';
import { splitProjectWorkspace } from '../../src/services/project/repository/lifecycle/workspaceProjection';
import { createRepositoryProject } from '../../src/services/project/repository/lifecycle/defaultProject';
import { encodeProjectDomains, PROJECT_ENTITY_KEY } from '../../src/services/project/repository/domains/projectDomains';
import { readEditorRepositoryWorkspace } from '../../src/services/project/repository/transaction/editorRepositorySession';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { RepositoryLocation } from '../../src/services/project/repository/storageWorkerProtocol';

// ---------------------------------------------------------------------------------------------
// Round clock: counts every folder operation and releases waiting operations in parallel rounds.

type OpKind = 'getDirectoryHandle' | 'getFileHandle' | 'getFile' | 'read' | 'createWritable' | 'write' | 'close' | 'abort'
  | 'removeEntry' | 'entries' | 'queryPermission' | 'isSameEntry';
interface OpRecord { kind: OpKind; path: string; round: number; site: string; stage: string; chain: string }

class RoundClock {
  readonly ops: OpRecord[] = [];
  rounds = 0;
  private waiting: Array<() => void> = [];
  private loop: Promise<void> | null = null;
  op(kind: OpKind, path: string): Promise<void> {
    const { site, stage, chain } = callSite(new Error().stack ?? '', kind, path);
    this.ops.push({ kind, path, round: this.rounds + 1, site, stage, chain });
    return new Promise(resolve => { this.waiting.push(resolve); this.ensureLoop(); });
  }
  private ensureLoop(): void {
    if (this.loop) return;
    this.loop = (async () => {
      for (;;) {
        await this.quiet();
        if (!this.waiting.length) break;
        const batch = this.waiting.splice(0); this.rounds++;
        for (const release of batch) release();
      }
      this.loop = null;
    })();
  }
  /** No new operation for a few real timer turns: everything that can run in parallel is waiting. */
  private async quiet(): Promise<void> {
    let seen = -1, stable = 0;
    while (stable < 3) {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (this.ops.length === seen) stable++; else { seen = this.ops.length; stable = 0; }
    }
  }
  /** Background work (startup cache, view writes, owner release) has finished. */
  async settle(): Promise<void> {
    for (let idle = 0; idle < 3;) {
      await new Promise(resolve => setTimeout(resolve, 15));
      if (!this.loop && !this.waiting.length) idle++; else idle = 0;
    }
  }
}

const REPOSITORY_FRAME = /at (?:async )?(?:([^\s(]+) \()?[^\s(]*?(src\/(?:services|workers)\/[^\s)]+?\.ts):(\d+)/;
/** Storage primitives: the interesting caller is the first frame above them. */
const PRIMITIVE_FILES = /\/(backends\/directoryBackend|persistence\/recoveryReadCache|segments\/recordSegment|archive\/streamIO)\.ts:/;
/** What a folder path is, for writes whose caller is lost behind the backend's write queue. */
function pathCategory(path: string): string {
  if (path.endsWith('project.msrepo.json')) return 'descriptor';
  const match = /\.masterselects\/(segments|commits|views|cache\/startup|artifacts|artifact-manifests|imports|transport)\//.exec(path);
  return match ? match[1] : path.includes('.masterselects') ? 'repository folder' : 'project folder';
}
/** Logical stage of an operation, from the function names on its (async) stack. First match wins. */
const STAGES: Array<[RegExp, string]> = [
  [/materializeProjection|materializeEntityReferences|readRevision/, 'open: projection reads entity records one by one'],
  [/indexCommit/, 'publish: index re-reads committed segment'],
  [/writePublication/, 'publish: write segment/commit + read-back + validate'],
  [/publishQueued/, 'publish: head re-discovery before/after write'],
  [/recoverRepository|RepositoryPersistence\.recover/, 'open: recovery (list commits, read + validate)'],
  [/WorkspaceViewStore/, 'views: slot read / write read-back / listing'],
  [/readRecord@/, 'open: navigation record request'],
  [/open@src\/workers\/projectStorage\.worker\.ts/, 'worker open: descriptor + backend probe'],
  [/prepareNewRepository|prepareRepositoryOpen|prepareTarget|isLegacyProjectLocation|createFsaRepositoryBackend|isLegacyProjectBackend/, 'main thread: prepare / probe location'],
];
/** Nearest product frame above the storage primitives (who asked), its stage, and the first frames of the chain. */
function callSite(stack: string, kind: OpKind, path: string): { site: string; stage: string; chain: string } {
  const frames = stack.split('\n').slice(1).map(line => REPOSITORY_FRAME.exec(line)).filter((match): match is RegExpExecArray => !!match)
    .map(match => `${(match[1] ?? '').replace(/^(Object|Module)\./, '')}@${match[2].replace('src/services/project/repository/', '')}:${match[3]}`);
  const product = frames.filter(frame => !PRIMITIVE_FILES.test('/' + frame.slice(frame.indexOf('@') + 1)));
  const all = frames.join(' <- ');
  const writing = kind === 'createWritable' || kind === 'write' || kind === 'close' || kind === 'abort';
  const stage = STAGES.find(([pattern]) => pattern.test(all))?.[1]
    ?? (frames.length && frames.every(frame => frame.includes('directoryBackend.ts')) ? `queued write: ${pathCategory(path)}${writing ? '' : ' (existence probe)'}` : null)
    ?? (frames.length ? `other: ${product[0] ?? frames[0]}` : 'harness: project folder');
  return { site: product[0] ?? frames[0] ?? 'harness (project folder)', stage, chain: frames.slice(0, 8).join(' <- ') };
}

// ---------------------------------------------------------------------------------------------
// In-memory FileSystemDirectoryHandle whose every call is counted and gated by the clock.

const notFound = () => new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError');

class CountedBlob {
  private readonly clock: RoundClock; private readonly path: string; private readonly bytes: Uint8Array;
  readonly name: string; readonly lastModified: number;
  constructor(clock: RoundClock, path: string, bytes: Uint8Array, name = '', lastModified = 0) {
    this.clock = clock; this.path = path; this.bytes = bytes; this.name = name; this.lastModified = lastModified;
  }
  get size() { return this.bytes.byteLength; }
  get type() { return ''; }
  slice(start = 0, end = this.bytes.byteLength) { return new CountedBlob(this.clock, this.path, this.bytes.slice(start, end), this.name, this.lastModified); }
  async arrayBuffer() { await this.clock.op('read', this.path); return this.bytes.slice().buffer; }
  async text() { await this.clock.op('read', this.path); return new TextDecoder().decode(this.bytes); }
}

interface FakeFile { bytes: Uint8Array; modified: number }
function countedFolder(clock: RoundClock, base = '', name = 'Projects'): FileSystemDirectoryHandle {
  const folders = new Map<string, FileSystemDirectoryHandle>();
  const files = new Map<string, FakeFile>();
  let stamp = 0;
  const fileHandle = (fileName: string) => {
    const path = base + fileName;
    return {
      kind: 'file' as const, name: fileName,
      async getFile() {
        await clock.op('getFile', path);
        const file = files.get(fileName); if (!file) throw notFound();
        return new CountedBlob(clock, path, file.bytes, fileName, file.modified);
      },
      async createWritable() {
        await clock.op('createWritable', path);
        const parts: Uint8Array[] = [];
        return {
          async write(chunk: Uint8Array) { await clock.op('write', path); parts.push(new Uint8Array(chunk)); },
          async close() {
            await clock.op('close', path);
            const bytes = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0)); let at = 0;
            for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
            files.set(fileName, { bytes, modified: ++stamp });
          },
          async abort() { await clock.op('abort', path); },
        };
      },
    };
  };
  const self: Record<string, unknown> = {
    kind: 'directory', name,
    async getDirectoryHandle(child: string, options?: { create?: boolean }) {
      await clock.op('getDirectoryHandle', base + child + '/');
      let folder = folders.get(child);
      if (!folder) { if (!options?.create) throw notFound(); folder = countedFolder(clock, base + child + '/', child); folders.set(child, folder); }
      return folder;
    },
    async getFileHandle(child: string, options?: { create?: boolean }) {
      await clock.op('getFileHandle', base + child);
      if (!files.has(child)) { if (!options?.create) throw notFound(); files.set(child, { bytes: new Uint8Array(), modified: ++stamp }); }
      return fileHandle(child);
    },
    async removeEntry(child: string) {
      await clock.op('removeEntry', base + child);
      if (!files.delete(child) && !folders.delete(child)) throw notFound();
    },
    async queryPermission() { await clock.op('queryPermission', base); return 'granted'; },
    async requestPermission() { return 'granted'; },
    async isSameEntry(other: unknown) { await clock.op('isSameEntry', base); return other === self; },
    async *entries() {
      // One listing is one provider query (Android: queryChildDocuments), however many entries it returns.
      await clock.op('entries', base);
      for (const [child, folder] of [...folders]) yield [child, folder];
      for (const child of [...files.keys()]) yield [child, fileHandle(child)];
    },
    async *keys() { for await (const [child] of (self.entries as () => AsyncGenerator<[string, unknown]>)()) yield child; },
    async *values() { for await (const [, handle] of (self.entries as () => AsyncGenerator<[string, unknown]>)()) yield handle; },
  };
  return self as unknown as FileSystemDirectoryHandle;
}

// ---------------------------------------------------------------------------------------------
// The project storage worker, loaded in-process: one fresh module instance per Worker like a real realm.

/** Structured-clone stand-in: copies plain data and bytes, passes handles and blobs by reference. */
function cloneMessage(value: unknown): unknown {
  if (value instanceof Uint8Array) return value.slice();
  if (Array.isArray(value)) return value.map(cloneMessage);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneMessage(key), cloneMessage(item)]));
  if (value instanceof Set) return new Set([...value].map(cloneMessage));
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    if (Object.values(value).some(item => typeof item === 'function')) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneMessage(item)]));
  }
  return value;
}
let workerImports: Promise<unknown> = Promise.resolve();
class InProcessStorageWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private terminated = false;
  private readonly scope = { onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (message: unknown) => { const data = cloneMessage(message); queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data }); }); } };
  private readonly ready: Promise<unknown>;
  constructor() {
    this.ready = workerImports = workerImports.then(async () => {
      vi.resetModules();
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
      Object.defineProperty(globalThis, 'self', { value: this.scope, configurable: true, writable: true });
      try { await import('../../src/workers/projectStorage.worker'); }
      finally { if (previous) Object.defineProperty(globalThis, 'self', previous); }
    });
  }
  postMessage(message: unknown) { const data = cloneMessage(message); void this.ready.then(() => { if (!this.terminated) this.scope.onmessage?.({ data }); }); }
  terminate() { this.terminated = true; }
}

// ---------------------------------------------------------------------------------------------
// Browser primitives the storage path needs.

function installBrowserPrimitives() {
  const held = new Set<string>(); const waiters: Array<() => void> = [];
  const locks = {
    async request(name: string, options: unknown, callback?: (lock: object | null) => Promise<unknown>) {
      const run = (typeof options === 'function' ? options : callback) as (lock: object | null) => Promise<unknown>;
      const ifAvailable = typeof options === 'object' && options !== null && (options as { ifAvailable?: boolean }).ifAvailable;
      while (held.has(name)) { if (ifAvailable) return run(null); await new Promise<void>(resolve => waiters.push(resolve)); }
      held.add(name);
      try { return await run({ name }); } finally { held.delete(name); for (const wake of waiters.splice(0)) wake(); }
    },
  };
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  vi.stubGlobal('FileSystemFileHandle', class { createWritable() {} });
  vi.stubGlobal('Worker', InProcessStorageWorker);
}

// ---------------------------------------------------------------------------------------------
// Scenarios.

const WORKSPACE_ID = 'operation-budget-workspace';
const noActivation = { canActivate: () => true, async activate() {} };

function smallProject(name: string): ProjectFile {
  const project = createRepositoryProject(name); const composition = project.compositions[0]!;
  const transform = { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, rotation: 0, rotationX: 0, rotationY: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1, blendMode: 'normal' };
  for (let index = 0; index < 3; index++) {
    project.media.push({ id: `media-${index}`, name: `shot-${index}.mp4`, type: 'video', sourcePath: `shot-${index}.mp4`, duration: 10,
      width: 1920, height: 1080, frameRate: 30, hasAudio: true, hasProxy: false } as ProjectFile['media'][number]);
    composition.clips.push({ id: `clip-${index}`, trackId: 'track-v1', name: `shot-${index}.mp4`, mediaId: `media-${index}`, startTime: index * 5,
      duration: 5, inPoint: 0, outPoint: 5, transform, effects: [], masks: [] } as unknown as ProjectFile['compositions'][number]['clips'][number]);
  }
  return project;
}

interface ScenarioResult { name: string; totalOps: number; criticalPathOps: number; simulatedMsAt50: number; byKind: Record<string, number>; ops: OpRecord[] }

function lifecycleFor(pendingViews: Map<string, JsonValue>) {
  return new RepositoryLifecycle({
    async barrier() { return { release() {} }; },
    // The editor merges its per-key workspace views on activation (one listing + slot reads).
    async activate(session, workspace) { await readEditorRepositoryWorkspace(session, workspace ?? {}); },
    install() {},
    // Save: the editor writes its split workspace parts (flushEditorWorkspace) before the receipt.
    async beforeReceipt(session) { for (const [key, value] of pendingViews) await session.updateView(key, value); pendingViews.clear(); },
  });
}

async function measure(clock: RoundClock, name: string, action: () => Promise<void>): Promise<ScenarioResult> {
  await clock.settle();
  const firstOp = clock.ops.length, firstRound = clock.rounds;
  await action();
  const criticalPathOps = clock.rounds - firstRound;
  await clock.settle();
  const ops = clock.ops.slice(firstOp);
  const byKind: Record<string, number> = {};
  for (const op of ops) byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  return { name, totalOps: ops.length, criticalPathOps, simulatedMsAt50: criticalPathOps * 50, byKind, ops };
}

async function runFolderScenarios(kind: 'empty' | 'small'): Promise<ScenarioResult[]> {
  const clock = new RoundClock();
  const parent = countedFolder(clock);
  const results: ScenarioResult[] = [];
  const project = kind === 'empty' ? createRepositoryProject('Phone project') : smallProject('Phone project');
  const encoded = encodeProjectDomains(project);
  const parts = Object.fromEntries(splitProjectWorkspace(encoded.workspace).map(part => [part.key, part.value]));
  let folder!: FileSystemDirectoryHandle; let location!: RepositoryLocation;

  // Create: ProjectCoreService.createProjectInFolder -> createRepositoryAt -> RepositoryLifecycle.open(create).
  const pendingViews = new Map<string, JsonValue>();
  let lifecycle = lifecycleFor(pendingViews); let session!: RepositorySession;
  results.push(await measure(clock, `${kind}: create`, async () => {
    folder = await parent.getDirectoryHandle('Phone project', { create: true });
    location = { kind: 'fsa', handle: folder };
    session = await lifecycle.open(async (): Promise<PreparedRepository> => {
      const prepared = await prepareNewRepository(location, WORKSPACE_ID);
      prepared.options.activation = noActivation;
      prepared.initialize = { entities: encoded.entities, workspace: parts, journals: encoded.journals };
      return prepared;
    }, 'create');
  }));

  // Save after one edit: a content transaction (rename, as renameRepositoryProject) plus a changed
  // workspace part, then the explicit Save (lifecycle.flush with the editor's receipt flush).
  results.push(await measure(clock, `${kind}: edit + save`, async () => {
    const root = session.coordinator.getProjection().entities.get(PROJECT_ENTITY_KEY)!;
    const token = session.coordinator.begin('Rename project', 'user');
    session.coordinator.write(token, PROJECT_ENTITY_KEY, { ...root, value: { ...(root.value as Record<string, JsonValue>), name: 'Renamed project' } });
    session.coordinator.commit(token);
    const [firstKey, firstValue] = Object.entries(parts)[0]!;
    pendingViews.set(firstKey, { ...(firstValue as Record<string, JsonValue>), savedFrom: 'operation-budget' });
    await lifecycle.flush({ retry: true, measure: true });
  }));

  // Save without changes: nothing to publish, no view changed.
  results.push(await measure(clock, `${kind}: save unchanged`, async () => { await lifecycle.flush({ retry: true, measure: true }); }));

  results.push(await measure(clock, `${kind}: close`, async () => { await lifecycle.close(); }));

  // Cold open (new tab / app restart): ProjectCoreService.loadProject -> isLegacyProjectLocation -> openRepositoryProject.
  lifecycle = lifecycleFor(pendingViews);
  results.push(await measure(clock, `${kind}: open`, async () => {
    expect(await isLegacyProjectLocation(location)).toBe(false);
    session = await lifecycle.open(async onProgress => {
      const prepared = await prepareRepositoryOpen(location, WORKSPACE_ID, onProgress);
      prepared.options.activation = noActivation;
      return prepared;
    });
  }));
  expect(session.coordinator.getProjection().entities.get(PROJECT_ENTITY_KEY)?.value).toMatchObject({ name: 'Renamed project' });
  await lifecycle.close(); await clock.settle();
  return results;
}

function report(results: ScenarioResult[]): void {
  const target = process.env.FOLDER_BUDGET_REPORT; if (!target) return;
  const lines: string[] = []; const console = { log: (line: string) => lines.push(line) };
  for (const result of results) {
    console.log(`\n== ${result.name}: ${result.totalOps} ops, ${result.criticalPathOps} sequential rounds, ${result.simulatedMsAt50} ms at 50 ms/op`);
    console.log('   by kind: ' + Object.entries(result.byKind).map(([kind, count]) => `${kind}=${count}`).join(' '));
    const stages = new Map<string, { ops: number; rounds: Set<number> }>();
    for (const op of result.ops) { const stage = stages.get(op.stage) ?? { ops: 0, rounds: new Set() }; stage.ops++; stage.rounds.add(op.round); stages.set(op.stage, stage); }
    console.log('   stages (ops / rounds it occupies):');
    for (const [stage, value] of [...stages].toSorted((a, b) => b[1].rounds.size - a[1].rounds.size || b[1].ops - a[1].ops))
      console.log(`   ${String(value.ops).padStart(4)} ops ${String(value.rounds.size).padStart(4)} rounds  ${stage}`);
    console.log('   call sites:');
    const sites = new Map<string, { ops: number; rounds: Set<number>; kinds: Map<string, number> }>();
    for (const op of result.ops) {
      const site = sites.get(op.site) ?? { ops: 0, rounds: new Set(), kinds: new Map() };
      site.ops++; site.rounds.add(op.round); site.kinds.set(op.kind, (site.kinds.get(op.kind) ?? 0) + 1); sites.set(op.site, site);
    }
    for (const [site, value] of [...sites].toSorted((a, b) => b[1].rounds.size - a[1].rounds.size || b[1].ops - a[1].ops).slice(0, 14))
      console.log(`   ${String(value.ops).padStart(4)} ops ${String(value.rounds.size).padStart(4)} rounds  ${site}  [${[...value.kinds].map(([kind, count]) => `${kind}:${count}`).join(' ')}]`);
    if (process.env.FOLDER_BUDGET_OPS) for (const op of result.ops) console.log(`     r${op.round} ${op.kind} ${op.path}  ${op.chain}`);
  }
  // A file path collects the report (the test console is not always shown); anything else prints it.
  if (target.includes('/')) appendFileSync(target, lines.join('\n') + '\n'); else globalThis.console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------------------------

/** CURRENT baseline (upper bounds); tighten when the folder path gets faster, never raise them silently. */
// Before the folder fast path (2026-10-27): create 93/93, edit + save 74/74, open 189/178 (empty) and
// 225/214 (3 clips) total/sequential. After it: session handle and write-once content caches, size-checked
// writes instead of read-backs, no duplicate head discovery, concurrent probes, listings and view writes,
// and the descriptor written once by the worker (create 1.9 s, save 0.95 s, open 0.95 s at 50 ms/op).
const BASELINE: Record<string, { totalOps: number; criticalPathOps: number }> = {
  'empty: create': { totalOps: 49, criticalPathOps: 38 },
  'empty: edit + save': { totalOps: 19, criticalPathOps: 19 },
  'empty: save unchanged': { totalOps: 0, criticalPathOps: 0 },
  'empty: close': { totalOps: 0, criticalPathOps: 0 },
  'empty: open': { totalOps: 38, criticalPathOps: 19 },
  'small: create': { totalOps: 49, criticalPathOps: 38 },
  'small: edit + save': { totalOps: 19, criticalPathOps: 19 },
  'small: save unchanged': { totalOps: 0, criticalPathOps: 0 },
  'small: close': { totalOps: 0, criticalPathOps: 0 },
  // Entity count no longer adds folder calls: records are sliced from the segments read once.
  'small: open': { totalOps: 38, criticalPathOps: 19 },
};

describe('folder project operation budget (File System Access backend)', () => {
  beforeAll(() => installBrowserPrimitives());
  afterAll(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'locks'); });

  for (const kind of ['empty', 'small'] as const) {
    it(`creates, saves and reopens ${kind === 'empty' ? 'an empty project' : 'a project with 3 clips'} within the operation budget`, async () => {
      const results = await runFolderScenarios(kind);
      report(results);
      expect(results.map(result => result.name)).toEqual(Object.keys(BASELINE).filter(name => name.startsWith(`${kind}:`)));
      for (const result of results) {
        const budget = BASELINE[result.name]!;
        // The harness itself must see the folder: a create or open without operations measured nothing.
        if (/create|open/.test(result.name)) expect(result.totalOps, `${result.name} reached the folder`).toBeGreaterThan(0);
        expect.soft(result.totalOps, `${result.name} total folder operations`).toBeLessThanOrEqual(budget.totalOps);
        expect.soft(result.criticalPathOps, `${result.name} sequential folder rounds`).toBeLessThanOrEqual(budget.criticalPathOps);
      }
    }, 120_000);
  }
});
