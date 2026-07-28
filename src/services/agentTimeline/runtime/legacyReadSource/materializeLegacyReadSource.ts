import type { ClipAnalysis, SceneSegment, TranscriptWord } from '../../../../types/clipMetadata';
import type { SceneCutAnalysis } from '../../../../types/sceneCutAnalysis';
import type { AudioAnalysisArtifact } from '../../../audio/audioArtifactTypes';
import type { OccurrenceMappingIndex } from '../../../../types/agentTimeline/occurrenceMapping';
import {
  SOURCE_IDENTITY_SCHEMA_VERSION,
  type SourceIdentity,
} from '../../../../types/agentTimeline/sourceIdentity';
import {
  AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
  type AgentTimelineChannel,
  type AgentTimelineManifest,
  type AgentTimelineProfile,
} from '../../../../types/agentTimeline/manifest';
import type { ResolvedAgentTimelineReadSource } from '../../../../types/agentTimeline/api';
import type { LegacyReadSourceArtifactInput } from '../../../../types/agentTimeline/legacyReadSource';
import { adaptLegacyClipAnalysis } from '../../adapters/clipAnalysisLegacyAdapter';
import { adaptLegacyTranscript } from '../../adapters/transcriptLegacyAdapter';
import {
  adaptLegacySceneCuts,
  adaptLegacySceneDescriptions,
} from '../../adapters/sceneLegacyAdapters';
import { adaptLegacyAudioArtifacts } from '../../adapters/audioArtifactLegacyAdapter';
import { adaptAudioIntelligenceArtifacts } from '../../adapters/audioIntelligenceLegacyAdapter';
import type { AudioIntelligencePayloads } from '../../artifacts/audioIntelligencePayloadLoader';
import { createArtifactShardIntervalIndex } from '../../artifacts/artifactShardIndex';
import { InMemoryLegacyShardReader } from './inMemoryLegacyShardReader';
import {
  materializeLegacyViews,
  type NamedLegacyView,
} from './legacyViewMaterializer';

const ALL_CHANNELS: AgentTimelineChannel[] = [
  'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
  'camera-motion', 'audio', 'quality', 'text', 'duplicates',
];

const PROFILES: readonly AgentTimelineProfile[] = ['quick', 'balanced', 'deep', 'custom'];
const SOURCE_IDENTITY_HASH = /^[a-f0-9]{64}$/;

export interface LegacyReadSourceMaterializerInput {
  sourceIdentity: SourceIdentity;
  mediaFileId: string;
  durationSeconds: number;
  generatedAt: string;
  profile: AgentTimelineProfile;
  clipAnalysis?: LegacyReadSourceArtifactInput<ClipAnalysis>;
  transcript?: LegacyReadSourceArtifactInput<readonly TranscriptWord[]>;
  sceneCuts?: LegacyReadSourceArtifactInput<SceneCutAnalysis>;
  sceneDescriptions?: LegacyReadSourceArtifactInput<readonly SceneSegment[]>;
  audioArtifacts?: LegacyReadSourceArtifactInput<readonly AudioAnalysisArtifact[]>;
  audioIntelligence?: LegacyReadSourceArtifactInput<AudioIntelligencePayloads>;
  occurrenceMapping?: OccurrenceMappingIndex;
  mappingSourceId?: string;
}

function assertNonEmptyText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertStateHash(value: unknown): asserts value is string {
  assertNonEmptyText(value, 'audioArtifacts.clipAudioStateHash');
  if (value !== value.trim()) {
    throw new TypeError('audioArtifacts.clipAudioStateHash must not include surrounding whitespace');
  }
}

function assertSourceIdentity(identity: SourceIdentity): void {
  if (identity.type !== 'source-identity' || identity.version !== SOURCE_IDENTITY_SCHEMA_VERSION
    || (identity.strategy !== 'sampled-chunks' && identity.strategy !== 'full-stream')
    || identity.hashAlgorithm !== 'sha-256' || !SOURCE_IDENTITY_HASH.test(identity.hash)
    || !Number.isSafeInteger(identity.metadata?.size) || identity.metadata.size < 0
    || typeof identity.metadata.mediaType !== 'string') {
    throw new TypeError('sourceIdentity must be a valid caller-supplied SourceIdentity');
  }
}

function assertCoverage(
  coverage: readonly { start: number; end: number }[] | undefined,
  durationSeconds: number,
  field: string,
): void {
  for (const range of coverage ?? []) {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)
      || range.start < 0 || range.end <= range.start || range.end > durationSeconds) {
      throw new RangeError(`${field} coverage must contain finite, in-bounds half-open source ranges`);
    }
  }
}

function assertAudioArtifacts(
  artifacts: readonly AudioAnalysisArtifact[] | null | undefined,
  mediaFileId: string,
  durationSeconds: number,
): void {
  for (const artifact of artifacts ?? []) {
    if (artifact.mediaFileId !== mediaFileId) {
      throw new TypeError('audioArtifacts must belong to mediaFileId');
    }
    if (!Number.isFinite(artifact.duration) || artifact.duration <= 0 || artifact.duration > durationSeconds) {
      throw new RangeError('audioArtifacts must have an in-bounds positive source duration');
    }
    if (artifact.clipAudioStateHash !== undefined) {
      assertStateHash(artifact.clipAudioStateHash);
    }
  }
}

function assertArtifactInputs(input: LegacyReadSourceMaterializerInput): void {
  const artifacts: Array<[string, LegacyReadSourceArtifactInput<unknown> | undefined]> = [
    ['clipAnalysis', input.clipAnalysis],
    ['transcript', input.transcript],
    ['sceneCuts', input.sceneCuts],
    ['sceneDescriptions', input.sceneDescriptions],
    ['audioArtifacts', input.audioArtifacts],
    ['audioIntelligence', input.audioIntelligence],
  ];
  for (const [name, artifact] of artifacts) {
    if (artifact === undefined) continue;
    if (artifact === null || typeof artifact !== 'object') {
      throw new TypeError(`${name} must be a durable artifact input object`);
    }
    if (artifact.artifactRef !== undefined) assertNonEmptyText(artifact.artifactRef, `${name}.artifactRef`);
    assertCoverage(artifact.coverage, input.durationSeconds, name);
  }
  assertAudioArtifacts(input.audioArtifacts?.value, input.mediaFileId, input.durationSeconds);
}

function assertInput(input: LegacyReadSourceMaterializerInput): void {
  assertNonEmptyText(input.mediaFileId, 'mediaFileId');
  assertSourceIdentity(input.sourceIdentity);
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new RangeError('durationSeconds must be positive');
  }
  const generatedTime = Date.parse(input.generatedAt);
  if (!Number.isFinite(generatedTime) || new Date(generatedTime).toISOString() !== input.generatedAt) {
    throw new TypeError('generatedAt must be a canonical ISO-8601 timestamp');
  }
  if (!PROFILES.includes(input.profile)) throw new TypeError('profile is invalid');
  if (input.mappingSourceId !== undefined) assertNonEmptyText(input.mappingSourceId, 'mappingSourceId');
  assertArtifactInputs(input);
}

function adapterRequest<T>(
  input: LegacyReadSourceMaterializerInput,
  artifact: LegacyReadSourceArtifactInput<T>,
  fallbackName: string,
) {
  return {
    queryRange: { start: 0, end: input.durationSeconds },
    profile: input.profile,
    artifactCoverage: artifact.coverage,
    artifactRef: artifact.artifactRef
      ?? `legacy-input/${encodeURIComponent(input.mediaFileId)}/${fallbackName}`,
  };
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Materializes existing durable analyses into the already-shipped bounded read
 * API contracts. It performs no hashing, decoding, storage access or payload IO.
 */
export function materializeLegacyAgentTimelineReadSource(
  input: LegacyReadSourceMaterializerInput,
): ResolvedAgentTimelineReadSource {
  assertInput(input);
  const namedViews: NamedLegacyView[] = [];
  if (input.clipAnalysis) {
    const views = adaptLegacyClipAnalysis(
      input.clipAnalysis.value,
      adapterRequest(input, input.clipAnalysis, 'clip-analysis'),
    );
    namedViews.push(
      { name: 'clip-analysis-quality', view: views.quality },
      { name: 'clip-analysis-motion', view: views.cameraMotion },
      { name: 'clip-analysis-faces', view: views.people },
    );
  }
  if (input.transcript) {
    namedViews.push({
      name: 'transcript',
      view: adaptLegacyTranscript(
        input.transcript.value,
        adapterRequest(input, input.transcript, 'transcript'),
      ),
    });
  }
  if (input.sceneCuts) {
    namedViews.push({
      name: 'scene-cuts',
      view: adaptLegacySceneCuts(
        input.sceneCuts.value,
        adapterRequest(input, input.sceneCuts, 'scene-cuts'),
      ),
    });
  }
  if (input.sceneDescriptions) {
    namedViews.push({
      name: 'scene-descriptions',
      view: adaptLegacySceneDescriptions(
        input.sceneDescriptions.value,
        adapterRequest(input, input.sceneDescriptions, 'scene-descriptions'),
      ),
    });
  }
  if (input.audioArtifacts) {
    const audioViews = adaptLegacyAudioArtifacts(
      input.audioArtifacts.value,
      adapterRequest(input, input.audioArtifacts, 'audio-artifacts'),
    );
    namedViews.push(...audioViews.map((view) => ({
      name: `audio-${view.timeDomain}-${view.stateHash ?? 'source'}`,
      view,
    })));
  }
  if (input.audioIntelligence?.value) {
    const views = adaptAudioIntelligenceArtifacts(
      input.audioIntelligence.value,
      adapterRequest(input, input.audioIntelligence, 'audio-intelligence'),
    );
    if (views.audioView) {
      namedViews.push({
        name: 'audio-intelligence',
        view: {
          ...views.audioView,
          events: views.audioView.events.filter((event) => event.type === 'audio-activity'),
        },
      });
      const qualityEvents = views.audioView.events.filter((event) => event.type === 'quality-issue');
      if (qualityEvents.length > 0) {
        namedViews.push({
          name: 'audio-intelligence-quality',
          view: { ...views.audioView, channel: 'quality', events: qualityEvents },
        });
      }
    }
    if (views.speechMarkerView) {
      namedViews.push({ name: 'audio-intelligence-speech-markers', view: views.speechMarkerView });
    }
  }

  const materialized = materializeLegacyViews(
    input.sourceIdentity.hash,
    input.mediaFileId,
    input.durationSeconds,
    input.generatedAt,
    input.profile,
    namedViews,
  );
  const channels = Object.fromEntries(ALL_CHANNELS.map((channel) => [
    channel,
    materialized.channels[channel] ?? { status: 'missing', artifacts: [] },
  ])) as AgentTimelineManifest['channels'];
  const manifest: AgentTimelineManifest = {
    schemaVersion: AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION,
    mediaFileId: input.mediaFileId,
    sourceIdentity: cloneSerializable(input.sourceIdentity),
    durationSeconds: input.durationSeconds,
    generatedAt: input.generatedAt,
    profile: input.profile,
    channels,
  };
  return {
    manifest,
    shardIndex: createArtifactShardIntervalIndex(materialized.descriptors),
    shardReader: new InMemoryLegacyShardReader(materialized.payloads),
    occurrenceMapping: input.occurrenceMapping
      ? cloneSerializable(input.occurrenceMapping)
      : undefined,
    mappingSourceId: input.mappingSourceId ?? input.mediaFileId,
  };
}
