import type { CameraSolveSourceContext } from './cameraSolvingContract';
import { analyzeScanImages, createScanSourcePreview, mergeScanSourceFiles, type ScanImageAnalysis } from './scanSourceAnalysis';
import { deleteScanPhoto, readScanSources, writeScanPhoto, writeScanSourceManifest, type ScanSourceStorage } from './scanSourceProjectStorage';

export interface ScanSourceRow extends ScanImageAnalysis { id: string; previewUrl: string }
export interface ScanSourceSnapshot {
  projectKey: string | null;
  photos: ScanSourceRow[];
  source: CameraSolveSourceContext | null;
  updatedAt: number;
  busy: boolean;
  persistence: 'memory' | 'saving' | 'project' | 'error';
  error: string | null;
}
const empty = (projectKey: string | null): ScanSourceSnapshot => ({
  projectKey, photos: [], source: null, updatedAt: 0, busy: false, persistence: 'memory', error: null,
});

/** Runtime owner for File/object URLs; only plain metadata is persisted. */
export class ScanSourceManager {
  private snapshot = empty(null);
  private listeners = new Set<() => void>();
  private storage: ScanSourceStorage | null = null;
  private generation = 0;
  private cancellation = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> = Promise.resolve();
  private writtenIds = new Set<string>();
  private removedIds = new Set<string>();
  private sourceGroup: string | null = null;
  private loadFailed = false;

  getSnapshot = (): ScanSourceSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  };
  get signal(): AbortSignal { return this.cancellation.signal; }

  activate(storage: ScanSourceStorage | null, projectKey: string | null): Promise<void> {
    if (this.storage === storage && this.snapshot.projectKey === projectKey) return this.ready;
    this.cancellation.abort(); this.cancellation = new AbortController();
    this.releasePreviews(this.snapshot.photos);
    this.storage = storage;
    const generation = ++this.generation;
    this.queue = Promise.resolve(); this.writtenIds = new Set(); this.removedIds = new Set();
    this.sourceGroup = null; this.loadFailed = false;
    this.update({ ...empty(projectKey), busy: Boolean(storage) });
    this.ready = (async () => {
      if (!storage) return;
      let rows: ScanSourceRow[] = [];
      try {
        const saved = await readScanSources(storage);
        this.assertCurrent(generation);
        rows = await this.makeRows(saved.files);
        this.assertCurrent(generation);
        this.writtenIds = new Set(rows.map(row => row.id));
        this.update({ ...this.snapshot, photos: rows, source: saved.source, updatedAt: saved.updatedAt,
          busy: false, persistence: 'project' });
      } catch (error) {
        this.releasePreviews(rows);
        if (generation !== this.generation) return;
        this.loadFailed = true;
        this.update({ ...this.snapshot, busy: false, persistence: 'error', error: String(error) });
      }
    })();
    return this.ready;
  }

  append(files: File[], source: CameraSolveSourceContext | null = null, group: string | null = null): Promise<string | null> {
    return this.enqueue(async generation => {
      const merged = mergeScanSourceFiles(this.snapshot.photos.map(row => row.file), files);
      const rejected = [merged.duplicates ? `${merged.duplicates} duplicate(s)` : '',
        merged.unsupported ? `${merged.unsupported} unsupported file(s)` : ''].filter(Boolean).join(' and ');
      if (!merged.files.length) return rejected ? `Skipped ${rejected}.` : null;
      const rows = await this.makeRows(merged.files.map(file => ({ id: crypto.randomUUID(), file })));
      if (generation !== this.generation) { this.releasePreviews(rows); this.assertCurrent(generation); }
      // Sample times follow insertion order, exactly like the files passed to SfM.
      const context = !this.snapshot.photos.length ? source
        : group && group === this.sourceGroup && source && this.snapshot.source
          ? { ...this.snapshot.source, sampleTimes: [...(this.snapshot.source.sampleTimes ?? []), ...(source.sampleTimes ?? [])] }
          : null;
      this.sourceGroup = group;
      this.update({ ...this.snapshot, photos: [...this.snapshot.photos, ...rows], source: context, updatedAt: Date.now() });
      await this.persist(generation);
      return rejected ? `Skipped ${rejected}.` : null;
    });
  }

  remove(key?: string): Promise<void> {
    return this.enqueue(async generation => {
      const removed = this.snapshot.photos.filter(row => key === undefined || row.key === key);
      const remaining = this.snapshot.photos.filter(row => !removed.includes(row));
      for (const row of removed) this.removedIds.add(row.id);
      this.releasePreviews(removed);
      this.sourceGroup = null;
      this.update({ ...this.snapshot, photos: remaining, source: null, updatedAt: Date.now() });
      await this.persist(generation);
    });
  }

  retry(): Promise<void> {
    if (this.loadFailed) {
      const { storage } = this; const key = this.snapshot.projectKey;
      this.storage = null; // Force another read, never overwrite unread saved data.
      return this.activate(storage, key);
    }
    return this.enqueue(generation => this.persist(generation));
  }

  private enqueue<T>(work: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.generation;
    const ready = this.ready;
    const run = this.queue.then(async () => {
      await ready; this.assertCurrent(generation);
      if (this.loadFailed) throw new Error('Restore the saved scan sources before changing this list.');
      this.update({ ...this.snapshot, busy: true, error: null });
      try { return await work(generation); }
      catch (error) {
        if (generation === this.generation) this.update({ ...this.snapshot, persistence: 'error', error: String(error) });
        throw error;
      } finally {
        if (generation === this.generation) this.update({ ...this.snapshot, busy: false });
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private async persist(generation: number): Promise<void> {
    this.assertCurrent(generation);
    const storage = this.storage;
    if (!storage) { this.update({ ...this.snapshot, persistence: 'memory' }); return; }
    this.update({ ...this.snapshot, persistence: 'saving' });
    for (const row of this.snapshot.photos) {
      this.assertCurrent(generation);
      if (this.writtenIds.has(row.id)) continue;
      await writeScanPhoto(storage, row);
      this.assertCurrent(generation);
      this.writtenIds.add(row.id);
    }
    await writeScanSourceManifest(storage, this.snapshot.photos, this.snapshot.source, this.snapshot.updatedAt);
    this.assertCurrent(generation);
    // Retire only our generated copies after the new list is safely published.
    for (const id of this.removedIds) {
      this.assertCurrent(generation);
      if (this.writtenIds.has(id)) await deleteScanPhoto(storage, id);
      this.assertCurrent(generation);
      this.removedIds.delete(id); this.writtenIds.delete(id);
    }
    this.update({ ...this.snapshot, persistence: 'project', error: null });
  }

  private async makeRows(files: { id: string; file: File }[]): Promise<ScanSourceRow[]> {
    const rows: ScanSourceRow[] = [];
    try {
      const analyses = await analyzeScanImages(files.map(entry => entry.file));
      for (const [index, analysis] of analyses.entries()) rows.push({ ...analysis, id: files[index].id,
        previewUrl: await createScanSourcePreview(analysis) });
      return rows;
    } catch (error) { this.releasePreviews(rows); throw error; }
  }
  private assertCurrent(generation: number): void {
    if (generation !== this.generation) throw new DOMException('Scan project changed.', 'AbortError');
  }
  private releasePreviews(rows: ScanSourceRow[]): void { rows.forEach(row => URL.revokeObjectURL(row.previewUrl)); }
  private update(snapshot: ScanSourceSnapshot): void { this.snapshot = snapshot; this.listeners.forEach(listener => listener()); }
}
