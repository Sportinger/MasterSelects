import type { MediaFile } from '../../../../stores/mediaStore/types';
import type { TimelineClip } from '../../../../types/timeline';
import type { ArtifactShardDescriptor } from '../../../../types/agentTimeline/artifactShard';
import type { AgentTimelineEvent, AgentTimelineManifest } from '../../../../types/agentTimeline/manifest';
import type { SourceIdentity } from '../../../../types/agentTimeline/sourceIdentity';
import type { AgentTimelineShardWrite } from '../../../../types/agentTimeline/storage';
import type { AudioAnalysisArtifact } from '../../../audio/audioArtifactTypes';
import { materializeLegacyAgentTimelineReadSource } from '../legacyReadSource/materializeLegacyReadSource';
import { loadAudioIntelligencePayloads } from '../../artifacts/audioIntelligencePayloadLoader';
import { sourceIdentityRuntimeCache } from '../sourceIdentityCache';
import type { AgentTimelineArtifactStorage } from '../../storage/AgentTimelineArtifactStorage';
import { projectFileService } from '../../../projectFileService';
import {
  collectSourceAnalysisSnapshots,
  sourceAnalysisSnapshotsMatch,
  type SourceAnalysisSnapshot,
} from './sourceAnalysisSnapshot';
import {
  readTimelineAnalysisClips,
  readTimelineAnalysisMediaFiles,
  subscribeTimelineAnalysisRuntime,
  readMediaRuntimeState,
} from '../../../timeline/timelineRuntimeCoordinator';

const DEBOUNCE_MS = 350;
const EVENT_TYPES: Record<ArtifactShardDescriptor['channel'], readonly AgentTimelineEvent['type'][]> = {
  cuts: ['cut'], shots: ['shot'], 'scene-blocks': ['scene-block'], focus: ['quality-issue'],
  motion: ['camera-motion'], faces: ['person-visible'], transcript: ['speech', 'speech-marker'],
  audio: ['audio-activity'], 'active-speaker': ['active-speaker'],
  'camera-motion': ['camera-motion'], quality: ['quality-issue'], ocr: ['onscreen-text'],
  redundancy: ['duplicate-group'],
};

type RuntimeSnapshot = { files: readonly MediaFile[]; clips: readonly TimelineClip[]; projectScope?: unknown };

export interface AgentTimelineRuntimePersistenceDependencies {
  readSnapshot(): RuntimeSnapshot;
  subscribe(listener: () => void): () => void;
  getSourceIdentity(source: Blob): Promise<SourceIdentity>;
  listAudioArtifacts(mediaFileId: string): Promise<readonly AudioAnalysisArtifact[]>;
  createStorage(): AgentTimelineArtifactStorage | Promise<AgentTimelineArtifactStorage>;
  now(): string;
  debounceMs: number;
}

interface PublishInput {
  mediaFileId: string;
  source: Blob;
  durationSeconds: number;
  media?: MediaFile;
  sourceClips: readonly TimelineClip[];
  projectScope?: unknown;
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sourceId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function runtimeSource(media: MediaFile | undefined, clips: readonly TimelineClip[]): Blob | undefined {
  // Unopened saved clips contain empty runtime placeholders, not source bytes.
  return [media?.file, ...clips.map(clip => clip.source?.file ?? (clip.needsReload ? undefined : clip.file))]
    .find((source): source is File => source !== undefined && source.size > 0);
}

function sourceDuration(media: MediaFile | undefined, clips: readonly TimelineClip[]): number | undefined {
  const values = [
    media?.duration,
    media?.sceneCutAnalysis?.duration,
    ...clips.map(clip => clip.source?.naturalDuration),
    ...clips.map(clip => clip.outPoint),
  ].filter(isDuration);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function selectReady<T>(clips: readonly TimelineClip[], value: (clip: TimelineClip) => T | undefined): T | undefined {
  for (const clip of clips.toSorted((left, right) => left.id.localeCompare(right.id))) {
    const selected = value(clip);
    if (selected !== undefined) return selected;
  }
  return undefined;
}

function validCoverage(ranges: readonly [number, number][] | undefined, durationSeconds: number) {
  const coverage = (ranges ?? [])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end)
      && start >= 0 && end > start && end <= durationSeconds)
    .map(([start, end]) => ({ start, end }));
  return coverage.length > 0 ? coverage : undefined;
}

function generatedAt(input: PublishInput, audio: readonly AudioAnalysisArtifact[], now: string): string {
  const timestamp = [
    // Embedded sources become new File objects on reload; their runtime mtime is not a generation time.
    input.media?.createdAt ?? (input.source as File).lastModified,
    input.media?.sceneCutAnalysis?.completedAt,
    ...audio.map(artifact => artifact.createdAt),
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    .reduce((latest, value) => Math.max(latest, value), 0);
  return timestamp > 0 ? new Date(timestamp).toISOString() : now;
}

function emptyManifest(manifest: AgentTimelineManifest): AgentTimelineManifest {
  return {
    ...manifest,
    channels: Object.fromEntries(Object.entries(manifest.channels).map(([channel, value]) => [channel, {
      status: value.status,
      artifacts: [],
      ...(value.error ? { error: value.error } : {}),
    }])) as unknown as AgentTimelineManifest['channels'],
  };
}

function isLegacyDescriptor(descriptor: ArtifactShardDescriptor): boolean {
  return descriptor.analyzerId.startsWith('legacy-read-source:');
}

function preserveCorrections(
  draft: AgentTimelineManifest,
  existing: Awaited<ReturnType<AgentTimelineArtifactStorage['read']>>,
): { manifest: AgentTimelineManifest; existingShardIndex?: import('../../../../types/agentTimeline/artifactShard').ArtifactShardIntervalIndex } {
  if (existing.status !== 'ready') return { manifest: draft };
  const descriptors = new Map(existing.analysis.shardIndex.entries.map(entry => [entry.shard.shardId, entry.shard]));
  const channels = { ...draft.channels };
  for (const channel of Object.keys(channels) as (keyof AgentTimelineManifest['channels'])[]) {
    const manualRefs = existing.analysis.manifest.channels[channel].artifacts.filter((ref) => {
      const descriptor = descriptors.get(ref.shardId);
      return descriptor !== undefined && !isLegacyDescriptor(descriptor);
    });
    if (manualRefs.length > 0) {
      channels[channel] = { ...channels[channel], artifacts: manualRefs.map(ref => ({ ...ref, coverage: ref.coverage.map(range => ({ ...range })) })) };
    }
  }
  return { manifest: { ...draft, channels }, existingShardIndex: existing.analysis.shardIndex };
}

function shardWrite(descriptor: ArtifactShardDescriptor, events: readonly AgentTimelineEvent[]): AgentTimelineShardWrite {
  const { artifactRef: _artifactRef, sizeBytes: _sizeBytes, type: _type, schemaVersion: _schemaVersion, shardId: _shardId, ...input } = descriptor;
  return { descriptor: input, eventTypes: EVENT_TYPES[descriptor.channel], events };
}

function signature(manifest: AgentTimelineManifest, writes: readonly AgentTimelineShardWrite[]): string {
  return JSON.stringify({
    source: manifest.sourceIdentity.hash,
    duration: manifest.durationSeconds,
    generatedAt: manifest.generatedAt,
    channels: Object.fromEntries(Object.entries(manifest.channels).map(([key, value]) => [key, value.status])),
    writes: writes.map(write => ({
      descriptor: {
        ...write.descriptor,
        sourceRange: { ...write.descriptor.sourceRange },
      },
      events: write.events,
    })),
  });
}

function defaultDependencies(): AgentTimelineRuntimePersistenceDependencies {
  return {
    readSnapshot: () => ({
      files: readTimelineAnalysisMediaFiles(),
      clips: readTimelineAnalysisClips(),
      projectScope: projectFileService.getProjectPackageSession()
        ?? projectFileService.getProjectHandle()
        ?? projectFileService.getProjectPath()
        ?? readMediaRuntimeState().currentProjectId,
    }),
    subscribe: subscribeTimelineAnalysisRuntime,
    getSourceIdentity: source => sourceIdentityRuntimeCache.get(source, { strategy: 'sampled-chunks' }),
    listAudioArtifacts: async (mediaFileId) => {
      const { createCurrentAudioArtifactStore } = await import('../../../audio/timelineWaveformPyramidCache');
      return createCurrentAudioArtifactStore().listAnalysisArtifacts(mediaFileId);
    },
    createStorage: async () => {
      const { createProjectAgentTimelineStorage } = await import('../../storage/projectAgentTimelineStorage');
      return createProjectAgentTimelineStorage();
    },
    now: () => new Date().toISOString(),
    debounceMs: DEBOUNCE_MS,
  };
}

/**
 * Coalesces completed local source-analysis state into immutable Agent Timeline
 * shards. It snapshots only durable analysis DTOs and never writes File/Blob,
 * DOM, model, embedding, or decoder values.
 */
export class AgentTimelineRuntimePersistence {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generations = new Map<string, number>();
  private readonly publishQueues = new Map<string, Promise<void>>();
  private readonly published = new Map<string, string>();
  private observedSources = new Map<string, SourceAnalysisSnapshot>();
  private projectScope: unknown;
  private unsubscribe?: () => void;
  private dependencies: AgentTimelineRuntimePersistenceDependencies;

  constructor(dependencies: AgentTimelineRuntimePersistenceDependencies = defaultDependencies()) {
    this.dependencies = dependencies;
  }

  /** Preserve the runtime owner across HMR while replacing its implementation. */
  static restore(previous?: AgentTimelineRuntimePersistence): AgentTimelineRuntimePersistence {
    if (!previous) return new AgentTimelineRuntimePersistence();
    const restart = Boolean(previous.unsubscribe);
    previous.dispose();
    Object.setPrototypeOf(previous, AgentTimelineRuntimePersistence.prototype);
    previous.observedSources = new Map();
    previous.dependencies = defaultDependencies();
    if (restart) {
      void Promise.allSettled([...previous.publishQueues.values()]).then(() => previous.start());
    }
    return previous;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.dependencies.subscribe(() => this.requestChangedSources());
    this.requestChangedSources();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    this.generations.forEach((generation, id) => this.generations.set(id, generation + 1));
    this.observedSources?.clear();
  }

  private requestChangedSources(): void {
    const snapshot = this.dependencies.readSnapshot();
    if (snapshot.projectScope !== this.projectScope) {
      this.timers.forEach(timer => clearTimeout(timer));
      this.timers.clear();
      this.generations.forEach((generation, id) => this.generations.set(id, generation + 1));
      this.observedSources.clear();
      this.published.clear();
      this.projectScope = snapshot.projectScope;
    }
    const sources = collectSourceAnalysisSnapshots(snapshot.files, snapshot.clips);
    for (const [id, next] of sources) {
      if (!sourceAnalysisSnapshotsMatch(this.observedSources.get(id), next)) this.request(id);
    }
    for (const id of this.observedSources.keys()) {
      if (sources.has(id)) continue;
      const timer = this.timers.get(id);
      if (timer) clearTimeout(timer);
      this.timers.delete(id);
      this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    }
    this.observedSources = sources;
  }

  requestAll(): void {
    for (const file of this.dependencies.readSnapshot().files) this.request(file.id);
  }

  request(mediaFileId: string): void {
    const generation = (this.generations.get(mediaFileId) ?? 0) + 1;
    this.generations.set(mediaFileId, generation);
    const existing = this.timers.get(mediaFileId);
    if (existing) clearTimeout(existing);
    this.timers.set(mediaFileId, setTimeout(() => {
      this.timers.delete(mediaFileId);
      void this.enqueue(mediaFileId, generation);
    }, this.dependencies.debounceMs));
  }

  /** Mainly useful to callers that have already coalesced a source update. */
  publish(mediaFileId: string, generation = this.generations.get(mediaFileId) ?? 0): Promise<void> {
    return this.enqueue(mediaFileId, generation);
  }

  private enqueue(mediaFileId: string, generation: number): Promise<void> {
    const previous = this.publishQueues.get(mediaFileId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.publishCurrent(mediaFileId, generation));
    this.publishQueues.set(mediaFileId, next);
    void next.finally(() => {
      if (this.publishQueues.get(mediaFileId) === next) this.publishQueues.delete(mediaFileId);
    });
    return next;
  }

  private async publishCurrent(mediaFileId: string, generation: number): Promise<void> {
    const input = this.inputFor(mediaFileId);
    if (!input || !this.isCurrent(mediaFileId, generation, input)) return;
    try {
      const audioArtifactsPromise = this.dependencies.listAudioArtifacts(mediaFileId);
      const [sourceIdentity, audioArtifacts, audioIntelligence] = await Promise.all([
        this.dependencies.getSourceIdentity(input.source),
        audioArtifactsPromise,
        audioArtifactsPromise.then(async (artifacts) => {
          const { createCurrentAudioArtifactStore } = await import('../../../audio/timelineWaveformPyramidCache');
          return loadAudioIntelligencePayloads(artifacts, createCurrentAudioArtifactStore());
        }),
      ]);
      if (!this.isCurrent(mediaFileId, generation, input)) return;
      const clips = input.sourceClips;
      const analysis = selectReady(clips, clip => clip.analysisStatus === 'ready' ? clip.analysis : undefined);
      const transcript = input.media?.transcriptStatus === 'ready' && input.media.transcript
        ? input.media.transcript
        : selectReady(clips, clip => clip.transcriptStatus === 'ready' ? clip.transcript : undefined);
      const descriptions = selectReady(clips, clip => (
        clip.sceneDescriptionStatus === 'ready' ? clip.sceneDescriptions : undefined
      ));
      const sceneCuts = input.media?.sceneCutStatus === 'ready' ? input.media.sceneCutAnalysis : undefined;
      const usableAudio = audioArtifacts.filter(artifact => artifact.mediaFileId === mediaFileId
        && isDuration(artifact.duration) && artifact.duration <= input.durationSeconds + 1e-6);
      const materialized = materializeLegacyAgentTimelineReadSource({
        sourceIdentity,
        mediaFileId,
        durationSeconds: input.durationSeconds,
        generatedAt: generatedAt(input, usableAudio, this.dependencies.now()),
        profile: 'balanced',
        ...(analysis ? { clipAnalysis: { value: analysis } } : {}),
        ...(transcript ? { transcript: { value: transcript, coverage: validCoverage(input.media?.transcribedRanges, input.durationSeconds) } } : {}),
        ...(sceneCuts ? { sceneCuts: { value: sceneCuts } } : {}),
        ...(descriptions ? { sceneDescriptions: { value: descriptions } } : {}),
        ...(usableAudio.length > 0 ? { audioArtifacts: { value: usableAudio } } : {}),
        ...(Object.keys(audioIntelligence).length > 0
          ? { audioIntelligence: { value: audioIntelligence } }
          : {}),
      });
      const writes = await Promise.all(materialized.shardIndex.entries.map(async ({ shard }) => shardWrite(
        shard,
        await materialized.shardReader.readEvents({
          shard,
          sourceRanges: [shard.sourceRange],
          eventTypes: EVENT_TYPES[shard.channel],
          granularity: 'event',
          includeFrames: false,
        }),
      )));
      if (writes.length === 0 || !this.isCurrent(mediaFileId, generation, input)) return;
      const draft = emptyManifest(materialized.manifest);
      const nextSignature = signature(draft, writes);
      const signatureKey = `${mediaFileId}:${sourceIdentity.hash}`;
      const storage = await this.dependencies.createStorage();
      const existing = await storage.read({ mediaFileId, sourceIdentity });
      if (!this.isCurrent(mediaFileId, generation, input)) return;
      // The HMR survivor knows this exact snapshot, but still checks that the
      // currently selected project retains its published pointer.
      if (this.published.get(signatureKey) === nextSignature && existing.status === 'ready') return;
      const persisted = preserveCorrections(draft, existing);
      if (!this.isCurrent(mediaFileId, generation, input)) return;
      await storage.write({ manifest: persisted.manifest, shards: writes, existingShardIndex: persisted.existingShardIndex });
      if (this.isCurrent(mediaFileId, generation, input)) this.published.set(signatureKey, nextSignature);
    } catch {
      // Analysis persistence is opportunistic. The live legacy source remains queryable.
    }
  }

  private inputFor(mediaFileId: string): PublishInput | undefined {
    const snapshot = this.dependencies.readSnapshot();
    const media = snapshot.files.find(file => file.id === mediaFileId);
    const sourceClips = snapshot.clips.filter(clip => sourceId(clip) === mediaFileId);
    const source = runtimeSource(media, sourceClips);
    const durationSeconds = sourceDuration(media, sourceClips);
    return source && durationSeconds
      ? { mediaFileId, source, durationSeconds, media, sourceClips, projectScope: snapshot.projectScope }
      : undefined;
  }

  private isCurrent(mediaFileId: string, generation: number, input: PublishInput): boolean {
    if (this.generations.get(mediaFileId) !== generation) return false;
    const current = this.inputFor(mediaFileId);
    return current?.source === input.source && current.projectScope === input.projectScope;
  }
}

type PersistenceGlobal = typeof globalThis & {
  __MASTERSELECTS_AGENT_TIMELINE_RUNTIME_PERSISTENCE__?: AgentTimelineRuntimePersistence;
};

const persistenceGlobal = globalThis as PersistenceGlobal;
export const agentTimelineRuntimePersistence = AgentTimelineRuntimePersistence.restore(
  import.meta.hot?.data?.persistence ?? persistenceGlobal.__MASTERSELECTS_AGENT_TIMELINE_RUNTIME_PERSISTENCE__,
);
persistenceGlobal.__MASTERSELECTS_AGENT_TIMELINE_RUNTIME_PERSISTENCE__ = agentTimelineRuntimePersistence;

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.persistence = agentTimelineRuntimePersistence; });
  import.meta.hot.accept();
}

export function startAgentTimelineRuntimePersistence(): void {
  agentTimelineRuntimePersistence.start();
}
