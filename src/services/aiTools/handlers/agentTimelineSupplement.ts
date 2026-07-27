import type {
  ClipAnalysis,
  SceneSegment,
  TranscriptWord,
} from '../../../types/clipMetadata';
import type { SceneCutAnalysis } from '../../../types/sceneCutAnalysis';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineChannel,
  type AgentTimelineEvent,
  type AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import type { AgentTimelineSelectedRangeRequest } from '../../../types/agentTimeline/api';
import type { OccurrenceMappingIndex } from '../../../types/agentTimeline/occurrenceMapping';
import type {
  AgentTimelineOverviewBin,
  AgentTimelineOverviewEvent,
} from '../../../types/agentTimeline/overview';
import type {
  LegacyFocusSampleRecord,
  LegacyMotionSampleRecord,
  LegacySceneDescriptionRecord,
} from '../../../types/agentTimeline/legacyAdapters';
import type { AudioAnalysisArtifact } from '../../audio/audioArtifactTypes';
import { adaptLegacyClipAnalysis } from '../../agentTimeline/adapters/clipAnalysisLegacyAdapter';
import { adaptLegacyTranscript } from '../../agentTimeline/adapters/transcriptLegacyAdapter';
import {
  adaptLegacySceneCuts,
  adaptLegacySceneDescriptions,
} from '../../agentTimeline/adapters/sceneLegacyAdapters';
import { adaptLegacyAudioArtifacts } from '../../agentTimeline/adapters/audioArtifactLegacyAdapter';
import { fuseAgentTimelineScenes } from '../../agentTimeline/fusion/scenes/fuseAgentTimelineScenes';
import { projectSourceInterval } from '../../agentTimeline/mapping/occurrenceMappingQueries';
import { buildOverviewTile } from '../../agentTimeline/overview/overviewTileBuilder';

export const AGENT_TIMELINE_AI_SUPPLEMENT_SCHEMA_VERSION =
  'agent-timeline-ai-supplement/v1' as const;

const MAX_SCENES = 24;
const MAX_TURNS_PER_SCENE = 24;
const MAX_PEOPLE_PER_SCENE = 20;
const MAX_DESCRIPTIONS_PER_SCENE = 4;
const MAX_DESCRIPTION_CHARACTERS = 600;
const MAX_TURN_CHARACTERS = 1_200;
const MAX_OVERVIEW_BINS = 64;
const MAX_SUPPLEMENT_BYTES = 64 * 1024;

interface NumericSummary {
  min: number;
  max: number;
  avg: number;
  sampleCount: number;
}

interface SceneOccurrence {
  clipId: string;
  compositionPath: readonly string[];
  compositionRange: AgentTimelineRange;
  clipLocalRange: AgentTimelineRange;
  direction: string;
}

interface SceneMix {
  id: string;
  sourceRange: AgentTimelineRange;
  boundaryBasis: 'rule-based-cut-fusion' | 'description-segment' | 'range-fallback';
  confidence: number;
  descriptions: Array<{ text: string; sourceRange: AgentTimelineRange }>;
  speakerTurns: Array<{
    speakerId: string;
    text: string;
    sourceRange: AgentTimelineRange;
    wordCount: number;
  }>;
  people: Array<{ personId: string; confidence: number }>;
  signals: {
    focus?: NumericSummary;
    brightness?: NumericSummary;
    motion?: NumericSummary;
    globalMotion?: NumericSummary;
    localMotion?: NumericSummary;
    audioLevel?: NumericSummary;
  };
  occurrences: SceneOccurrence[];
  missing: string[];
}

interface OverviewSignal {
  signal: 'focus' | 'motion' | 'audio-level';
  channel: AgentTimelineChannel;
  status: 'complete' | 'partial' | 'missing' | 'stale';
  binDuration?: number;
  bins: AgentTimelineOverviewBin[];
  covered: readonly AgentTimelineRange[];
  missing: readonly AgentTimelineRange[];
  reason?: string;
}

export interface AgentTimelineAiSupplement {
  schemaVersion: typeof AGENT_TIMELINE_AI_SUPPLEMENT_SCHEMA_VERSION;
  timeDomain: 'source';
  canonicalSourceRanges: readonly AgentTimelineRange[];
  scenes: SceneMix[];
  overview: OverviewSignal[];
  channelSummaries: Array<Record<string, unknown>>;
  truncation: {
    truncated: boolean;
    reason?: 'scene-limit' | 'byte-limit';
    returnedScenes: number;
    estimatedBytes: number;
    guidance?: string;
  };
}

export interface BuildAgentTimelineAiSupplementInput {
  sourceId: string;
  durationSeconds: number;
  request: AgentTimelineSelectedRangeRequest;
  canonicalSourceRanges: readonly AgentTimelineRange[];
  occurrenceMapping?: OccurrenceMappingIndex;
  clipAnalysis?: ClipAnalysis;
  transcript?: readonly TranscriptWord[];
  transcriptCoverage?: readonly AgentTimelineRange[];
  sceneCuts?: SceneCutAnalysis;
  sceneDescriptions?: readonly SceneSegment[];
  audioArtifacts?: readonly AudioAnalysisArtifact[];
  waveform?: readonly number[];
}

function overlaps(left: AgentTimelineRange, right: AgentTimelineRange): boolean {
  return left.start < right.end && left.end > right.start;
}

function intersect(left: AgentTimelineRange, right: AgentTimelineRange): AgentTimelineRange | null {
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return start < end ? { start, end } : null;
}

function mergeRanges(ranges: readonly AgentTimelineRange[]): AgentTimelineRange[] {
  const ordered = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end)
      && range.start >= 0 && range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function holes(range: AgentTimelineRange, coverage: readonly AgentTimelineRange[]): AgentTimelineRange[] {
  const output: AgentTimelineRange[] = [];
  let cursor = range.start;
  for (const covered of mergeRanges(coverage).map((item) => intersect(item, range)).filter(Boolean)) {
    const item = covered as AgentTimelineRange;
    if (cursor < item.start) output.push({ start: cursor, end: item.start });
    cursor = Math.max(cursor, item.end);
  }
  if (cursor < range.end) output.push({ start: cursor, end: range.end });
  return output;
}

function summarize(values: readonly number[]): NumericSummary | undefined {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return undefined;
  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
    avg: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    sampleCount: finite.length,
  };
}

function artifactRequest(range: AgentTimelineRange, coverage?: readonly AgentTimelineRange[]) {
  return {
    queryRange: range,
    profile: 'balanced' as const,
    artifactCoverage: coverage,
    artifactRef: 'live-agent-timeline-ai-supplement',
  };
}

interface RangeViews {
  range: AgentTimelineRange;
  cuts: AgentTimelineEvent[];
  speech: AgentTimelineEvent[];
  people: AgentTimelineEvent[];
  focus: LegacyFocusSampleRecord[];
  motion: LegacyMotionSampleRecord[];
  descriptions: LegacySceneDescriptionRecord[];
  focusCoverage: AgentTimelineRange[];
  motionCoverage: AgentTimelineRange[];
}

function viewsForRange(
  input: BuildAgentTimelineAiSupplementInput,
  range: AgentTimelineRange,
): RangeViews {
  const analysis = adaptLegacyClipAnalysis(input.clipAnalysis, artifactRequest(range));
  return {
    range,
    cuts: adaptLegacySceneCuts(input.sceneCuts, artifactRequest(range)).events,
    speech: adaptLegacyTranscript(
      input.transcript,
      artifactRequest(range, input.transcriptCoverage),
    ).events,
    people: analysis.people.events,
    focus: analysis.quality.records,
    motion: analysis.cameraMotion.records,
    descriptions: adaptLegacySceneDescriptions(
      input.sceneDescriptions,
      artifactRequest(range),
    ).records,
    focusCoverage: analysis.quality.coverage,
    motionCoverage: analysis.cameraMotion.coverage,
  };
}

function shotEvents(
  sourceId: string,
  range: AgentTimelineRange,
  cuts: readonly AgentTimelineEvent[],
): AgentTimelineEvent[] {
  const boundaries = [
    range.start,
    ...cuts.flatMap((event) => (
      event.type === 'cut'
      && event.time.temporalKind === 'point'
      && event.time.time > range.start
      && event.time.time < range.end
        ? [event.time.time]
        : []
    )),
    range.end,
  ].toSorted((left, right) => left - right)
    .filter((time, index, all) => index === 0 || time > all[index - 1]);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const id = `live-shot-${sourceId}-${start.toFixed(6)}-${end.toFixed(6)}`;
    return {
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id,
      type: 'shot',
      time: { temporalKind: 'interval', timeDomain: 'source', start, end },
      confidence: 0.65,
      provenance: [{
        kind: 'analyzer',
        analyzerId: 'live-cut-to-shot-fallback',
        analyzerVersion: '1',
      }],
      data: { shotId: id },
    };
  });
}

function sceneRanges(
  sourceId: string,
  views: RangeViews,
): Array<{
  range: AgentTimelineRange;
  basis: SceneMix['boundaryBasis'];
  confidence: number;
}> {
  const shots = shotEvents(sourceId, views.range, views.cuts);
  const fused = fuseAgentTimelineScenes({
    sourceId,
    range: views.range,
    events: [...shots, ...views.cuts, ...views.speech, ...views.people],
    policy: {
      minimumSceneDuration: 0.25,
      strongCutMinimumScore: 0.5,
      strongCutMinimumConfidence: 0.5,
      minimumBoundaryConfidence: 0.5,
    },
  });
  if (views.cuts.length > 0 && fused.sceneEvents.length > 0) {
    return fused.sceneEvents.map((event) => ({
      range: { start: event.time.start, end: event.time.end },
      basis: 'rule-based-cut-fusion',
      confidence: event.confidence,
    }));
  }
  if (views.descriptions.length > 0) {
    return views.descriptions.flatMap((description) => {
      const selected = intersect(
        { start: description.start, end: description.end },
        views.range,
      );
      return selected ? [{
        range: selected,
        basis: 'description-segment' as const,
        confidence: 0.7,
      }] : [];
    });
  }
  return [{ range: { ...views.range }, basis: 'range-fallback', confidence: 0 }];
}

function speakerTurns(
  speech: readonly AgentTimelineEvent[],
  range: AgentTimelineRange,
): SceneMix['speakerTurns'] {
  const words = speech
    .filter((event) => event.type === 'speech'
      && event.time.temporalKind === 'interval'
      && overlaps({ start: event.time.start, end: event.time.end }, range))
    .toSorted((left, right) => (
      (left.time.temporalKind === 'interval' ? left.time.start : 0)
      - (right.time.temporalKind === 'interval' ? right.time.start : 0)
    ));
  const turns: SceneMix['speakerTurns'] = [];
  for (const event of words) {
    if (event.type !== 'speech' || event.time.temporalKind !== 'interval') continue;
    const wordRange = intersect({ start: event.time.start, end: event.time.end }, range);
    if (!wordRange) continue;
    const speakerId = event.data.speakerId || 'unknown';
    const previous = turns.at(-1);
    const text = event.data.text?.trim() ?? '';
    if (previous && previous.speakerId === speakerId
      && previous.text.length + text.length + 1 <= MAX_TURN_CHARACTERS) {
      previous.text = `${previous.text} ${text}`.trim();
      previous.sourceRange.end = Math.max(previous.sourceRange.end, wordRange.end);
      previous.wordCount += 1;
    } else if (turns.length < MAX_TURNS_PER_SCENE) {
      turns.push({ speakerId, text, sourceRange: wordRange, wordCount: 1 });
    }
  }
  return turns;
}

function matchesScope(
  clipId: string,
  compositionPath: readonly string[],
  request: AgentTimelineSelectedRangeRequest,
): boolean {
  if (request.scope.clipId && request.scope.clipId !== clipId) return false;
  if (request.scope.compositionId && !compositionPath.includes(request.scope.compositionId)) return false;
  const expected = request.scope.compositionPath;
  return !expected || (
    expected.length === compositionPath.length
    && expected.every((part, index) => part === compositionPath[index])
  );
}

function occurrencesFor(
  range: AgentTimelineRange,
  input: BuildAgentTimelineAiSupplementInput,
): SceneOccurrence[] {
  if (!input.occurrenceMapping) return [];
  return projectSourceInterval(input.occurrenceMapping, {
    sourceId: input.sourceId,
    sourceRange: range,
  }).flatMap((projection) => {
    if (!matchesScope(projection.clipId, projection.compositionPath, input.request)) return [];
    const origin = Math.min(...input.occurrenceMapping!.segments
      .filter((segment) => segment.occurrenceId === projection.occurrenceId)
      .map((segment) => segment.compositionRange.start));
    const clipLocalRange = {
      start: projection.compositionRange.start - origin,
      end: projection.compositionRange.end - origin,
    };
    const requestedRange = { start: input.request.start, end: input.request.end };
    const domainRange = input.request.timeDomain === 'composition'
      ? projection.compositionRange
      : input.request.timeDomain === 'clip-local'
        ? clipLocalRange
        : range;
    if (!overlaps(domainRange, requestedRange)) return [];
    return [{
      clipId: projection.clipId,
      compositionPath: projection.compositionPath,
      compositionRange: projection.compositionRange,
      clipLocalRange,
      direction: projection.direction,
    }];
  }).slice(0, 16);
}

function waveformValues(
  waveform: readonly number[] | undefined,
  duration: number,
  range: AgentTimelineRange,
): number[] {
  if (!waveform || waveform.length === 0) return [];
  const startIndex = Math.max(0, Math.floor(range.start / duration * waveform.length));
  const endIndex = Math.min(waveform.length, Math.ceil(range.end / duration * waveform.length));
  return waveform.slice(startIndex, endIndex)
    .map((value) => Math.max(0, Math.min(1, Math.abs(value))))
    .filter(Number.isFinite);
}

function mixScene(
  input: BuildAgentTimelineAiSupplementInput,
  views: RangeViews,
  item: ReturnType<typeof sceneRanges>[number],
  index: number,
): SceneMix {
  const descriptions = input.request.channels.includes('scenes') ? views.descriptions
    .filter((description) => overlaps(
      { start: description.start, end: description.end },
      item.range,
    ))
    .slice(0, MAX_DESCRIPTIONS_PER_SCENE)
    .map((description) => ({
      text: description.text.slice(0, MAX_DESCRIPTION_CHARACTERS),
      sourceRange: { start: description.start, end: description.end },
    })) : [];
  const people = input.request.channels.includes('people') ? views.people
    .filter((event) => event.type === 'person-visible'
      && event.time.temporalKind === 'interval'
      && overlaps({ start: event.time.start, end: event.time.end }, item.range))
    .map((event) => event.type === 'person-visible'
      ? { personId: event.data.personId, confidence: event.confidence }
      : null)
    .filter((value): value is { personId: string; confidence: number } => value !== null)
    .filter((value, personIndex, all) => (
      all.findIndex((candidate) => candidate.personId === value.personId) === personIndex
    ))
    .slice(0, MAX_PEOPLE_PER_SCENE) : [];
  const focus = input.request.channels.includes('quality') ? views.focus.filter((record) => (
    record.time >= item.range.start && record.time < item.range.end
  )) : [];
  const motion = input.request.channels.includes('camera-motion') ? views.motion.filter((record) => (
    record.time >= item.range.start && record.time < item.range.end
  )) : [];
  const turns = input.request.channels.includes('speech')
    ? speakerTurns(views.speech, item.range)
    : [];
  const audioValues = input.request.channels.includes('audio')
    ? waveformValues(input.waveform, input.durationSeconds, item.range)
    : [];
  const missing = [
    ...(input.request.channels.includes('scenes') && descriptions.length === 0
      ? ['scene-description-unavailable'] : []),
    ...(input.request.channels.includes('speech') && turns.length === 0
      ? ['speech-unavailable'] : []),
    ...(input.request.channels.includes('people') && people.length === 0
      ? ['people-unavailable'] : []),
    ...(input.request.channels.includes('quality') && focus.length === 0
      ? ['focus-unavailable'] : []),
    ...(input.request.channels.includes('camera-motion') && motion.length === 0
      ? ['motion-unavailable'] : []),
    ...(input.request.channels.includes('audio') && audioValues.length === 0
      ? ['audio-level-unavailable']
      : []),
  ];
  return {
    id: `scene-mix-${item.range.start.toFixed(6)}-${item.range.end.toFixed(6)}-${index}`,
    sourceRange: item.range,
    boundaryBasis: item.basis,
    confidence: item.confidence,
    descriptions,
    speakerTurns: turns,
    people,
    signals: {
      focus: summarize(focus.map((record) => record.focus)),
      brightness: summarize(focus.map((record) => record.brightness)),
      motion: summarize(motion.map((record) => record.motion)),
      globalMotion: summarize(motion.map((record) => record.globalMotion)),
      localMotion: summarize(motion.map((record) => record.localMotion)),
      audioLevel: summarize(audioValues),
    },
    occurrences: occurrencesFor(item.range, input),
    missing,
  };
}

function overviewEvents(
  input: BuildAgentTimelineAiSupplementInput,
  views: readonly RangeViews[],
  signal: OverviewSignal['signal'],
): AgentTimelineOverviewEvent[] {
  if (signal === 'focus') {
    return views.flatMap((view) => view.focus.map((record) => ({
      id: `focus-${record.time}`,
      channel: 'quality' as const,
      time: { temporalKind: 'point' as const, time: record.time },
      numericValue: record.focus,
      label: 'focus',
    })));
  }
  if (signal === 'motion') {
    return views.flatMap((view) => view.motion.map((record) => ({
      id: `motion-${record.time}`,
      channel: 'camera-motion' as const,
      time: { temporalKind: 'point' as const, time: record.time },
      numericValue: record.globalMotion,
      label: 'global-motion',
    })));
  }
  if (input.waveform && input.waveform.length > 0) {
    return input.waveform.map((value, index) => ({
      id: `audio-${index}`,
      channel: 'audio' as const,
      time: {
        temporalKind: 'point' as const,
        time: index / input.waveform!.length * input.durationSeconds,
      },
      numericValue: Math.max(0, Math.min(1, Math.abs(value))),
      label: 'waveform-level',
    }));
  }
  return [];
}

function buildOverview(
  input: BuildAgentTimelineAiSupplementInput,
  views: readonly RangeViews[],
  signal: OverviewSignal['signal'],
  channel: AgentTimelineChannel,
  coverage: readonly AgentTimelineRange[],
  missingReason: string,
): OverviewSignal {
  const events = overviewEvents(input, views, signal);
  const selectedRange = {
    start: Math.min(...input.canonicalSourceRanges.map((range) => range.start)),
    end: Math.max(...input.canonicalSourceRanges.map((range) => range.end)),
  };
  const binDuration = Math.max(0.05, (selectedRange.end - selectedRange.start) / 32);
  const tileBinCount = 32;
  const tileSpan = binDuration * tileBinCount;
  const firstTile = Math.floor(selectedRange.start / tileSpan);
  const lastTile = Math.floor(Math.max(selectedRange.start, selectedRange.end - 1e-9) / tileSpan);
  const bins = Array.from({ length: lastTile - firstTile + 1 }, (_, offset) => (
    buildOverviewTile({
      sourceId: input.sourceId,
      channel,
      timeDomain: 'source',
      level: 0,
      tileIndex: firstTile + offset,
      baseBinDuration: binDuration,
      tileBinCount,
      duration: input.durationSeconds,
      inputArtifactIds: ['live-agent-timeline-ai-supplement'],
      coverage,
      maxLabelCounts: 2,
      maxCategoryCounts: 2,
    }, [events])
  )).flatMap((tile) => tile.bins)
    .filter((bin) => input.canonicalSourceRanges.some((range) => overlaps(bin.range, range)))
    .slice(0, MAX_OVERVIEW_BINS);
  const covered = mergeRanges(coverage.flatMap((item) => (
    input.canonicalSourceRanges.flatMap((range) => {
      const selected = intersect(item, range);
      return selected ? [selected] : [];
    })
  )));
  const missing = input.canonicalSourceRanges.flatMap((range) => holes(range, covered));
  const status = covered.length === 0
    ? 'missing'
    : missing.length === 0 ? 'complete' : 'partial';
  return {
    signal,
    channel,
    status,
    binDuration,
    bins,
    covered,
    missing,
    reason: events.length === 0 ? missingReason : undefined,
  };
}

function supplementBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function enforceBudget(supplement: AgentTimelineAiSupplement): AgentTimelineAiSupplement {
  let truncated = supplement.truncation.truncated;
  let reason = supplement.truncation.reason;
  while (supplementBytes(supplement) > MAX_SUPPLEMENT_BYTES) {
    const largestOverview = supplement.overview
      .toSorted((left, right) => right.bins.length - left.bins.length)
      .at(0);
    if (largestOverview && largestOverview.bins.length > 4) {
      largestOverview.bins = largestOverview.bins.slice(0, -1);
    } else if (supplement.scenes.length > 1) {
      supplement.scenes.pop();
    } else {
      break;
    }
    truncated = true;
    reason = 'byte-limit';
  }
  const estimatedBytes = supplementBytes(supplement);
  supplement.truncation = {
    truncated,
    reason,
    returnedScenes: supplement.scenes.length,
    estimatedBytes,
    guidance: truncated
      ? 'Narrow the requested time range to retrieve omitted scene detail.'
      : undefined,
  };
  return supplement;
}

export function buildAgentTimelineAiSupplement(
  input: BuildAgentTimelineAiSupplementInput,
): AgentTimelineAiSupplement {
  const canonicalSourceRanges = mergeRanges(input.canonicalSourceRanges);
  if (canonicalSourceRanges.length === 0) {
    return {
      schemaVersion: AGENT_TIMELINE_AI_SUPPLEMENT_SCHEMA_VERSION,
      timeDomain: 'source',
      canonicalSourceRanges: [],
      scenes: [],
      overview: [],
      channelSummaries: input.request.channels.map((channel) => ({
        channel,
        status: 'missing',
        reason: 'requested range has no canonical source mapping',
      })),
      truncation: { truncated: false, returnedScenes: 0, estimatedBytes: 0 },
    };
  }
  const views = canonicalSourceRanges.map((range) => viewsForRange(input, range));
  const allSceneRanges = views.flatMap((view) => sceneRanges(input.sourceId, view)
    .map((item) => ({ view, item })));
  const scenes = allSceneRanges.slice(0, MAX_SCENES)
    .map(({ view, item }, index) => mixScene(input, view, item, index));
  const focusCoverage = mergeRanges(views.flatMap((view) => view.focusCoverage));
  const motionCoverage = mergeRanges(views.flatMap((view) => view.motionCoverage));
  const audioViews = adaptLegacyAudioArtifacts(
    input.audioArtifacts,
    artifactRequest({ start: 0, end: input.durationSeconds }),
  );
  const audioCoverage = input.waveform && input.waveform.length > 0
    ? [{ start: 0, end: input.durationSeconds }]
    : mergeRanges(audioViews
      .filter((view) => view.timeDomain === 'source')
      .flatMap((view) => view.coverage));
  const overview = [
    ...(input.request.channels.includes('quality')
      ? [buildOverview(input, views, 'focus', 'quality', focusCoverage, 'focus samples unavailable')]
      : []),
    ...(input.request.channels.includes('camera-motion')
      ? [buildOverview(input, views, 'motion', 'camera-motion', motionCoverage, 'motion samples unavailable')]
      : []),
    ...(input.request.channels.includes('audio')
      ? [buildOverview(input, views, 'audio-level', 'audio', audioCoverage, (
          input.audioArtifacts?.length
            ? 'audio artifacts exist, but no numeric waveform payload is loaded'
            : 'audio analysis and waveform unavailable'
        ))]
      : []),
  ];
  const channelSummaries: Array<Record<string, unknown>> = overview.map((item) => ({
    channel: item.channel,
    signal: item.signal,
    status: item.status,
    covered: item.covered,
    missing: item.missing,
    sampleCount: item.bins.reduce((sum, bin) => sum + (bin.numeric?.sampleCount ?? 0), 0),
    reason: item.reason,
  }));
  if (input.request.channels.includes('scenes')) {
    channelSummaries.push({
      channel: 'scenes',
      status: scenes.length > 0 ? 'partial' : 'missing',
      sceneCount: scenes.length,
      boundaryBasis: [...new Set(scenes.map((scene) => scene.boundaryBasis))],
      reason: scenes.every((scene) => scene.boundaryBasis === 'range-fallback')
        ? 'no cut or description boundaries; one explicit range fallback was returned'
        : undefined,
    });
  }
  if (input.request.channels.includes('audio')) {
    channelSummaries.push({
      channel: 'audio-artifacts',
      status: input.audioArtifacts?.length ? 'available-reference-only' : 'missing',
      artifactCount: input.audioArtifacts?.length ?? 0,
      kinds: [...new Set((input.audioArtifacts ?? []).map((artifact) => artifact.kind))].toSorted(),
      limitation: input.audioArtifacts?.length
        ? 'payloads were not loaded into the agent response'
        : undefined,
    });
  }
  return enforceBudget({
    schemaVersion: AGENT_TIMELINE_AI_SUPPLEMENT_SCHEMA_VERSION,
    timeDomain: 'source',
    canonicalSourceRanges,
    scenes,
    overview,
    channelSummaries,
    truncation: {
      truncated: allSceneRanges.length > MAX_SCENES,
      reason: allSceneRanges.length > MAX_SCENES ? 'scene-limit' : undefined,
      returnedScenes: scenes.length,
      estimatedBytes: 0,
    },
  });
}
