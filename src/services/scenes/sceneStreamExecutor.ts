import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { ToolResult } from '../aiTools/types';
import { resolveStreamReferences } from '../nodeGraph/fencedRecordStream';
import { yieldEditorPresentationFrame } from '../flashboard/yieldEditorPresentationFrame';
import { formatSceneStream, type SceneStreamRecord } from './sceneStream';
import { loadSceneRegistry, saveScene, type SceneEntities, type SceneRegistry, type SceneRegistryEntry } from './sceneDocuments';

/** Same shape as a node stream failure, so chat feedback and turn history treat both alike. */
export interface SceneStreamFailure { scene: string; seq: number; ref: string; tool: string; args: Record<string, unknown>; error: string; executed: boolean }
export interface SceneRunSummary {
  scene: string;
  compositionId: string | null;
  executed: number;
  failed: number;
  removed: SceneEntities;
  created: SceneEntities;
  /** Result ids per record alias, for follow-up edits. */
  results: Record<string, Record<string, unknown>>;
  documentId?: string;
}

type Execute = (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
type ToolRecord = Extract<SceneStreamRecord, { op: 'tool' }>;

const emptyEntities = (): SceneEntities => ({ tracks: [], clips: [], markers: [] });

function entityIds(): { tracks: Set<string>; clips: Set<string>; markers: Set<string> } {
  const state = useTimelineStore.getState();
  return { tracks: new Set(state.tracks.map(track => track.id)), clips: new Set(state.clips.map(clip => clip.id)),
    markers: new Set((state.markers ?? []).map(marker => marker.id)) };
}

/** Ids that exist now but did not in `before`. */
function createdSince(before: ReturnType<typeof entityIds>): SceneEntities {
  const after = entityIds();
  const fresh = (now: Set<string>, then: Set<string>) => [...now].filter(id => !then.has(id));
  return { tracks: fresh(after.tracks, before.tracks), clips: fresh(after.clips, before.clips), markers: fresh(after.markers, before.markers) };
}

/** Remove what a scene's previous run created. Tracks go only when nothing else is left on them. */
export function removeSceneEntities(registry: SceneRegistry): SceneEntities {
  const removed = emptyEntities();
  const clips = new Set(registry.entries.flatMap(entry => entry.clips));
  for (const id of clips) {
    if (!useTimelineStore.getState().clips.some(clip => clip.id === id)) continue;
    useTimelineStore.getState().removeClip(id);
    removed.clips.push(id);
  }
  for (const id of new Set(registry.entries.flatMap(entry => entry.markers))) {
    if (!(useTimelineStore.getState().markers ?? []).some(marker => marker.id === id)) continue;
    useTimelineStore.getState().removeMarker(id);
    removed.markers.push(id);
  }
  for (const id of new Set(registry.entries.flatMap(entry => entry.tracks))) {
    const state = useTimelineStore.getState();
    if (!state.tracks.some(track => track.id === id) || state.clips.some(clip => clip.trackId === id)) continue;
    state.removeTrack(id);
    removed.tracks.push(id);
  }
  return removed;
}

/** Only ids and scalars go back to the caller; full clip payloads would flood the agent context. */
function compactResult(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data as Record<string, unknown>)
    .filter(([key, value]) => ['string', 'number', 'boolean'].includes(typeof value) && (/id$/i.test(key) || ['figure', 'name', 'start', 'duration'].includes(key))));
}

/**
 * Executes ms-scene-v1 records. Each record's created tracks, clips and markers are recorded
 * (by diffing the timeline, so every tool works without per-tool knowledge); at `end` the
 * scene text and registry are stored, and a later run of the same scene replaces them.
 */
export class SceneStreamExecutor {
  readonly failures: SceneStreamFailure[] = [];
  readonly summaries: SceneRunSummary[] = [];
  private current: { begin: Extract<SceneStreamRecord, { op: 'begin' }>; records: SceneStreamRecord[];
    entries: SceneRegistryEntry[]; results: Map<string, unknown>; summary: SceneRunSummary } | null = null;
  private readonly execute: Execute;
  private readonly signal?: AbortSignal;
  private stopped = false;
  constructor(execute: Execute, signal?: AbortSignal) { this.execute = execute; this.signal = signal; }
  stop(): void { this.stopped = true; }

  /** Records run so far in the scene that has not reached its end record yet. */
  get openExecuted(): number { return this.current?.summary.executed ?? 0; }

  async accept(record: SceneStreamRecord): Promise<SceneStreamFailure | undefined> {
    if (this.stopped || this.signal?.aborted) throw new Error('Scene stream stopped.');
    if (record.op === 'begin') return this.begin(record);
    const scene = this.current;
    if (!scene) throw new Error('Scene stream record outside a scene block.');
    scene.records.push(record);
    if (record.op === 'end') { this.finish(); return; }
    return this.operation(record);
  }

  private async begin(begin: Extract<SceneStreamRecord, { op: 'begin' }>): Promise<undefined> {
    if (this.current) this.finish();
    if (useTimelineStore.getState().isExporting) throw new Error('Scene streams cannot run while exporting.');
    const previous = loadSceneRegistry(begin.scene);
    const compositionId = begin.compositionId ?? previous?.compositionId ?? null;
    if (compositionId && useMediaStore.getState().activeCompositionId !== compositionId) {
      const opened = await this.execute('openComposition', { compositionId });
      if (!opened.success) throw new Error(`Scene "${begin.scene}": ${opened.error ?? 'could not open its composition.'}`);
    }
    const removed = previous && begin.replace ? removeSceneEntities(previous) : emptyEntities();
    // Without replace, the previous run's entities stay owned so the next replacing run removes them too.
    const kept = previous && !begin.replace ? previous.entries : [];
    this.current = { begin, records: [begin], entries: [...kept], results: new Map(),
      summary: { scene: begin.scene, compositionId: useMediaStore.getState().activeCompositionId ?? null, executed: 0, failed: 0,
        removed, created: emptyEntities(), results: {} } };
    return undefined;
  }

  private async operation(record: ToolRecord): Promise<SceneStreamFailure | undefined> {
    const scene = this.current!;
    const before = entityIds();
    let result: ToolResult;
    let executed = false;
    try {
      const args = resolveStreamReferences(record.args, scene.results, { label: 'Scene' }) as Record<string, unknown>;
      executed = true;
      result = await this.execute(record.tool, args);
    } catch (error) {
      if (this.stopped || this.signal?.aborted) throw error;
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    const created = createdSince(before);
    if (created.tracks.length || created.clips.length || created.markers.length) {
      scene.entries.push({ ref: record.ref, tool: record.tool, ...created });
      for (const kind of ['tracks', 'clips', 'markers'] as const) scene.summary.created[kind].push(...created[kind]);
    }
    if (!result.success) {
      const failure = { scene: scene.begin.scene, seq: record.seq, ref: record.ref, tool: record.tool, args: record.args,
        error: result.error ?? `${record.tool} failed.`, executed };
      this.failures.push(failure);
      scene.summary.failed++;
      return failure;
    }
    scene.results.set(record.ref, result.data);
    const compact = compactResult(result.data);
    if (Object.keys(compact).length) scene.summary.results[record.ref] = compact;
    scene.summary.executed++;
    // One presented frame per record: the timeline visibly builds up while the stream arrives.
    await yieldEditorPresentationFrame();
    return undefined;
  }

  /** Store the scene; also called for a block that ended without its end record. */
  finish(): void {
    const scene = this.current;
    if (!scene) return;
    this.current = null;
    if (scene.records.at(-1)?.op !== 'end') scene.records.push({ op: 'end', lastSeq: scene.records.filter(r => r.op === 'tool').length });
    const registry: SceneRegistry = { msSceneRegistry: 1, scene: scene.begin.scene, compositionId: scene.summary.compositionId,
      updatedAt: Date.now(), entries: scene.entries };
    scene.summary.documentId = saveScene(scene.begin.scene, formatSceneStream(scene.records), registry);
    this.summaries.push(scene.summary);
  }
}
