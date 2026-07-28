import type {
  ClipAnalysis,
  FacePersonSummary,
  FrameAnalysisData,
  SceneSegment,
  TranscriptWord,
} from '../../../../types/clipMetadata';
import type { SceneCutPoint } from '../../../../types/sceneCutAnalysis';
import type { AnalysisOverviewEvent, AnalysisOverviewInput } from './analysisOverviewTypes';
import type {
  AnalysisCoverageState,
  AnalysisSceneCoverage,
  AnalysisScenePerson,
  AnalysisSceneQualityIssue,
  AnalysisSceneRange,
  AnalysisSceneSpeakerTurn,
  AnalysisSceneTranscriptWord,
  AnalysisSceneView,
} from './analysisSceneViewModel';
import { effectiveWordTiming } from '../../../../services/transcription/effectiveWordTiming';
import { normalizedRanges, partitionIndexedRanges } from './analysisWorkspaceRangeIndex';

/** The selected source-time interval; the out point is always exclusive. */
export interface AnalysisWorkspaceSourceRange {
  inPoint: number;
  outPoint: number;
}

export interface AnalysisWorkspaceAdapterInput {
  range: AnalysisWorkspaceSourceRange;
  analysis?: ClipAnalysis;
  cuts?: readonly SceneCutPoint[];
  sceneSegments?: readonly SceneSegment[];
  transcript?: readonly TranscriptWord[];
  audio?: AnalysisWorkspaceAudioInput;
  channels?: Partial<Record<AnalysisWorkspaceChannel, AnalysisWorkspaceChannelInput>>;
}

export interface AnalysisWorkspaceAudioInput {
  levels?: readonly { start: number; end: number; loudnessDb: number }[];
  vadSegments?: readonly { start: number; end: number; probability: number }[];
  markers?: readonly { id: string; kind: string; time: number; text?: string; confidence?: number }[];
}

type AnalysisWorkspaceChannel = 'cuts' | 'metrics' | 'faces' | 'transcript' | 'descriptions' | 'audio';
type AnalysisWorkspaceChannelStatus = 'none' | 'partial' | 'analyzing' | 'transcribing' | 'describing' | 'ready' | 'error';

/** Explicit producer state and measured source coverage; event counts never imply coverage. */
export interface AnalysisWorkspaceChannelInput {
  status: AnalysisWorkspaceChannelStatus;
  measuredRanges?: readonly AnalysisSceneRange[];
}

export interface AnalysisWorkspaceViewModel {
  overview: AnalysisOverviewInput;
  scenes: readonly AnalysisSceneView[];
}

const MINIMUM_RANGE_DURATION = 0.001;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clipRange(range: AnalysisWorkspaceSourceRange): AnalysisSceneRange {
  const start = finite(range.inPoint) ? Math.max(0, range.inPoint) : 0;
  const requestedEnd = finite(range.outPoint) ? range.outPoint : start;
  return { start, end: Math.max(start + MINIMUM_RANGE_DURATION, requestedEnd) };
}

function clampRange(range: AnalysisSceneRange, bounds: AnalysisSceneRange): AnalysisSceneRange | undefined {
  const start = Math.max(bounds.start, range.start);
  const end = Math.min(bounds.end, range.end);
  return end > start ? { start, end } : undefined;
}

function overlaps(left: AnalysisSceneRange, right: AnalysisSceneRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function sorted<T>(items: readonly T[], compare: (left: T, right: T) => number): readonly T[] {
  return items.toSorted(compare);
}

function eventRange(start: number, end: number | undefined, bounds: AnalysisSceneRange): AnalysisSceneRange | undefined {
  if (!finite(start)) return undefined;
  return clampRange({ start, end: finite(end ?? start) ? Math.max(start, end ?? start) : start }, bounds);
}

function frameRange(frame: FrameAnalysisData, sampleInterval: number, bounds: AnalysisSceneRange): AnalysisSceneRange | undefined {
  const duration = finite(sampleInterval) && sampleInterval > 0 ? sampleInterval / 1000 : MINIMUM_RANGE_DURATION;
  return eventRange(frame.timestamp, frame.timestamp + duration, bounds);
}

function score(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

function percentage(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Math.round(value * 100)}%`;
}

function average(frames: readonly FrameAnalysisData[], key: keyof Pick<FrameAnalysisData, 'globalMotion' | 'motion' | 'focus' | 'brightness'>): number | undefined {
  const values = frames.map(frame => score(frame[key])).filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function channelCoverage(
  channel: AnalysisWorkspaceChannel,
  scene: AnalysisSceneRange,
  bounds: AnalysisSceneRange,
  input: AnalysisWorkspaceAdapterInput,
  inferred: AnalysisWorkspaceChannelInput | undefined,
): AnalysisSceneCoverage {
  const explicit = input.channels?.[channel];
  const state = explicit ? { ...explicit, measuredRanges: explicit.measuredRanges ?? inferred?.measuredRanges } : inferred;
  if (!state) return channel === 'audio'
    ? coverage('unavailable', 'No audio-analysis input is available.')
    : coverage('missing', 'This analysis channel has not run.');
  if (state.status === 'ready') {
    const measured = normalizedRanges(state.measuredRanges, bounds);
    if (measured.some(range => overlaps(range, scene))) return coverage('complete');
    return measured.length > 0
      ? coverage('partial', 'This ready analysis covers other source ranges.')
      : coverage('missing', 'This ready analysis has no measured source coverage.');
  }
  if (state.status === 'analyzing' || state.status === 'transcribing' || state.status === 'describing') {
    return coverage('partial', 'Analysis is still running.');
  }
  if (state.status === 'partial') return coverage('partial', 'Some audio-intelligence artifacts are available.');
  return coverage('missing', state.status === 'error' ? 'Analysis failed.' : 'Analysis has not run.');
}

function coverage(state: AnalysisCoverageState, detail?: string): AnalysisSceneCoverage {
  return detail ? { state, detail } : { state };
}

function rangesForPerson(person: FacePersonSummary, bounds: AnalysisSceneRange): readonly AnalysisSceneRange[] {
  return sorted(person.appearances
    .map(appearance => clampRange(appearance, bounds))
    .filter((appearance): appearance is AnalysisSceneRange => appearance !== undefined), (left, right) => left.start - right.start || left.end - right.end);
}

function peopleForScene(people: readonly FacePersonSummary[], scene: AnalysisSceneRange): readonly AnalysisScenePerson[] {
  return sorted(people.flatMap(person => {
    const appearances = rangesForPerson(person, scene).filter(appearance => overlaps(scene, appearance));
    if (appearances.length === 0) return [];
    const presence = { start: appearances[0].start, end: appearances.at(-1)?.end ?? appearances[0].end };
    return [{
      id: person.id,
      label: person.label,
      confidence: score(person.averageConfidence),
      sampleCount: person.sampleCount,
      presence,
      appearances,
    }];
  }), (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function transcriptWords(words: readonly TranscriptWord[], bounds: AnalysisSceneRange): readonly AnalysisSceneTranscriptWord[] {
  return sorted(words.flatMap(word => {
    const timing = effectiveWordTiming(word);
    const range = eventRange(timing.start, timing.end, bounds);
    if (!range) return [];
    return [{
      id: word.id,
      text: word.text,
      ...range,
      speakerId: word.speaker,
      speakerLabel: word.speaker,
      confidence: score(word.confidence),
      needsReview: word.needsReview,
      ...(word.emphasis !== undefined ? { emphasis: word.emphasis } : {}),
    }];
  }), (left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
}

function indexedFrames(
  frames: readonly FrameAnalysisData[],
  sampleInterval: number,
  bounds: AnalysisSceneRange,
): readonly { value: FrameAnalysisData; range: AnalysisSceneRange }[] {
  return frames.flatMap(frame => {
    const range = frameRange(frame, sampleInterval, bounds);
    return range ? [{ value: frame, range }] : [];
  });
}

function indexedWords(
  words: readonly TranscriptWord[],
  bounds: AnalysisSceneRange,
): readonly { value: AnalysisSceneTranscriptWord; range: AnalysisSceneRange }[] {
  return transcriptWords(words, bounds).map(value => ({ value, range: { start: value.start, end: value.end } }));
}

function speakerTurns(words: readonly AnalysisSceneTranscriptWord[], people: readonly AnalysisScenePerson[]): readonly AnalysisSceneSpeakerTurn[] {
  const turns: AnalysisSceneSpeakerTurn[] = [];
  for (const word of words) {
    const speakerLabel = word.speakerLabel?.trim() || 'Unknown speaker';
    const previous = turns.at(-1);
    if (previous && previous.speakerLabel === speakerLabel && previous.speakerId === word.speakerId) {
      previous.end = Math.max(previous.end, word.end);
      continue;
    }
    const matchedPerson = people.find(person => person.id === word.speakerId || person.label === speakerLabel);
    turns.push({
      id: `turn:${word.id}`,
      start: word.start,
      end: word.end,
      speakerId: word.speakerId,
      speakerLabel,
      personId: matchedPerson?.id,
      state: matchedPerson ? 'active' : word.speakerId || word.speakerLabel ? 'offscreen' : 'unknown',
      confidence: word.confidence,
    });
  }
  return turns;
}

function qualityIssues(frames: readonly FrameAnalysisData[], sampleInterval: number, bounds: AnalysisSceneRange): readonly AnalysisSceneQualityIssue[] {
  return frames.flatMap((frame, index) => {
    const range = frameRange(frame, sampleInterval, bounds);
    if (!range) return [];
    const issues: AnalysisSceneQualityIssue[] = [];
    if (score(frame.focus) !== undefined && frame.focus < 0.3) {
      issues.push({ id: `focus:${index}`, ...range, label: 'Soft focus', severity: 'warning', detail: percentage(score(frame.focus)) });
    }
    if (score(frame.brightness) !== undefined && frame.brightness < 0.15) {
      issues.push({ id: `dark:${index}`, ...range, label: 'Very dark', severity: 'warning', detail: percentage(score(frame.brightness)) });
    }
    return issues;
  });
}

function sceneRanges(segments: readonly SceneSegment[], cuts: readonly SceneCutPoint[], bounds: AnalysisSceneRange): readonly { id: string; range: AnalysisSceneRange; description?: string; boundarySource: AnalysisSceneView['boundarySource'] }[] {
  const segmentRanges = sorted(segments.flatMap(segment => {
    const range = eventRange(segment.start, segment.end, bounds);
    return range ? [{ id: segment.id, range, description: segment.text.trim() || undefined, boundarySource: 'scene-block' as const }] : [];
  }), (left, right) => left.range.start - right.range.start || left.range.end - right.range.end || left.id.localeCompare(right.id));
  if (segmentRanges.length > 0) return segmentRanges;

  const cutTimes = sorted(cuts
    .map(cut => cut.timestamp)
    .filter(timestamp => finite(timestamp) && timestamp > bounds.start && timestamp < bounds.end), (left, right) => left - right);
  if (cutTimes.length === 0) return [{ id: `range:${bounds.start}-${bounds.end}`, range: bounds, boundarySource: 'shot-fallback' }];

  const boundaries = [bounds.start, ...cutTimes, bounds.end];
  return boundaries.slice(0, -1).map((start, index) => ({
    id: `shot:${index}:${start}`,
    range: { start, end: boundaries[index + 1] },
    boundarySource: 'shot-fallback' as const,
  }));
}

function makeScene(
  source: { id: string; range: AnalysisSceneRange; description?: string; boundarySource: AnalysisSceneView['boundarySource'] },
  index: number,
  sceneFrames: readonly FrameAnalysisData[],
  sampleInterval: number,
  people: readonly FacePersonSummary[],
  sceneWords: readonly AnalysisSceneTranscriptWord[],
  input: AnalysisWorkspaceAdapterInput,
  bounds: AnalysisSceneRange,
  inferredChannels: Partial<Record<AnalysisWorkspaceChannel, AnalysisWorkspaceChannelInput>>,
): AnalysisSceneView {
  const scenePeople = peopleForScene(people, source.range);
  const motion = average(sceneFrames, 'globalMotion') ?? average(sceneFrames, 'motion');
  const focus = average(sceneFrames, 'focus');
  const brightness = average(sceneFrames, 'brightness');
  const issues = qualityIssues(sceneFrames, sampleInterval, source.range);
  return {
    id: source.id,
    index,
    boundarySource: source.boundarySource,
    range: source.range,
    people: scenePeople,
    speakerTurns: speakerTurns(sceneWords, scenePeople),
    transcript: sceneWords,
    ...(source.description ? { description: { text: source.description, provenance: 'scene description' } } : {}),
    ...(motion === undefined ? {} : { motion: { label: 'Camera motion', detail: percentage(motion), confidence: motion } }),
    ...(focus === undefined ? {} : { focus: { label: 'Focus', detail: percentage(focus), confidence: focus } }),
    ...(brightness === undefined ? {} : { setup: { label: 'Brightness', detail: percentage(brightness), confidence: brightness } }),
    ocr: [],
    qualityIssues: issues,
    coverage: {
      scenes: (input.channels?.descriptions ?? inferredChannels.descriptions)?.status === 'ready'
        ? coverage('complete')
        : (input.channels?.cuts ?? inferredChannels.cuts)?.status === 'ready'
          ? coverage('partial', 'Shot boundaries were derived from detected cuts.')
          : coverage('missing', 'Showing the selected clip range because no boundaries are available.'),
      cuts: channelCoverage('cuts', source.range, bounds, input, inferredChannels.cuts),
      speech: channelCoverage('transcript', source.range, bounds, input, inferredChannels.transcript),
      people: channelCoverage('faces', source.range, bounds, input, inferredChannels.faces),
      motion: channelCoverage('metrics', source.range, bounds, input, inferredChannels.metrics),
      focus: channelCoverage('metrics', source.range, bounds, input, inferredChannels.metrics),
      quality: channelCoverage('metrics', source.range, bounds, input, inferredChannels.metrics),
      audio: channelCoverage('audio', source.range, bounds, input, inferredChannels.audio),
      text: channelCoverage('descriptions', source.range, bounds, input, inferredChannels.descriptions),
    },
  };
}

/**
 * Builds the presentation-only workspace model from durable, source-time data.
 * The adapter never changes its inputs and does not retain media/runtime handles.
 */
export function buildAnalysisWorkspaceViewModel(input: AnalysisWorkspaceAdapterInput): AnalysisWorkspaceViewModel {
  const bounds = clipRange(input.range);
  const analysis = input.analysis;
  const frames = sorted((analysis?.frames ?? []).filter(frame => finite(frame.timestamp)), (left, right) => left.timestamp - right.timestamp);
  const cuts = sorted((input.cuts ?? []).filter(cut => finite(cut.timestamp) && cut.timestamp >= bounds.start && cut.timestamp < bounds.end), (left, right) => left.timestamp - right.timestamp || left.frameNumber - right.frameNumber);
  const segments = input.sceneSegments ?? [];
  const words = input.transcript ?? [];
  const people = analysis?.faceAnalysis?.people ?? [];
  const sampleInterval = analysis?.sampleInterval ?? 0;
  const sources = sceneRanges(segments, cuts, bounds);
  const frameEntries = indexedFrames(frames, sampleInterval, bounds);
  const wordEntries = indexedWords(words, bounds);
  const sceneRangesOnly = sources.map(source => source.range);
  const framesByScene = partitionIndexedRanges(sceneRangesOnly, frameEntries);
  const wordsByScene = partitionIndexedRanges(sceneRangesOnly, wordEntries);
  const inferredChannels: Partial<Record<AnalysisWorkspaceChannel, AnalysisWorkspaceChannelInput>> = {
    ...(input.cuts !== undefined ? { cuts: { status: 'ready', measuredRanges: [bounds] } } : {}),
    ...(analysis ? { metrics: { status: 'ready', measuredRanges: frameEntries.map(entry => entry.range) } } : {}),
    ...(analysis?.faceAnalysis ? { faces: { status: 'ready', measuredRanges: [bounds] } } : {}),
    ...(input.transcript !== undefined ? { transcript: { status: 'ready', measuredRanges: [bounds] } } : {}),
    ...(input.sceneSegments !== undefined ? { descriptions: { status: 'ready', measuredRanges: sources.map(source => source.range) } } : {}),
    ...(input.audio ? {
      audio: {
        status: 'ready',
        measuredRanges: [
          ...(input.audio.levels ?? []),
          ...(input.audio.vadSegments ?? []),
        ].map(({ start, end }) => ({ start, end })),
      },
    } : {}),
  };
  const scenes = sources.map((source, index) => makeScene(
    source,
    index + 1,
    framesByScene[index],
    sampleInterval,
    people,
    wordsByScene[index],
    input,
    bounds,
    inferredChannels,
  ));

  const frameEvents = (metric: 'globalMotion' | 'focus' | 'brightness', label: string): readonly AnalysisOverviewEvent[] => frames.flatMap((frame, index) => {
    const range = frameRange(frame, sampleInterval, bounds);
    const metricScore = score(frame[metric]);
    return range && metricScore !== undefined ? [{ id: `${metric}:${index}`, ...range, label, score: metricScore }] : [];
  });
  const peopleEvents = people.flatMap(person => rangesForPerson(person, bounds).map((range, index) => ({ id: `person:${person.id}:${index}`, ...range, label: person.label, score: score(person.averageConfidence) })));
  const speechEvents = wordEntries.map(({ value: word }) => ({ id: `speech:${word.id}`, start: word.start, end: word.end, label: word.speakerLabel ?? word.text, score: word.confidence }));
  const audioEvents: AnalysisOverviewEvent[] = [
    ...(input.audio?.levels ?? []).flatMap((level, index) => {
      const range = eventRange(level.start, level.end, bounds);
      if (!range || !finite(level.loudnessDb)) return [];
      return [{ id: `level:${index}`, ...range, label: 'Loudness', score: score((level.loudnessDb + 60) / 60) }];
    }),
    ...(input.audio?.vadSegments ?? []).flatMap((segment, index) => {
      const range = eventRange(segment.start, segment.end, bounds);
      return range ? [{ id: `vad:${index}`, ...range, label: 'Speech activity', score: score(segment.probability) }] : [];
    }),
  ];
  const markerEvents: readonly AnalysisOverviewEvent[] = sorted((input.audio?.markers ?? []).flatMap(marker => (
    finite(marker.time) && marker.time >= bounds.start && marker.time < bounds.end
      ? [{ id: marker.id, start: marker.time, label: marker.kind, score: score(marker.confidence) }]
      : []
  )), (left, right) => left.start - right.start || left.id.localeCompare(right.id));

  return {
    overview: {
      // Source coordinates stay unshifted: sourceTime can be passed directly to the editor playhead.
      startTime: bounds.start,
      duration: bounds.end - bounds.start,
      lanes: {
        scenes: scenes.map(scene => ({ id: scene.id, ...scene.range, label: `Scene ${scene.index}` })),
        cuts: cuts.map(cut => ({ id: `cut:${cut.frameNumber}`, start: cut.timestamp, label: 'Cut', score: score(cut.score) })),
        speech: speechEvents,
        people: peopleEvents,
        motion: frameEvents('globalMotion', 'Motion'),
        focus: frameEvents('focus', 'Focus'),
        quality: frameEvents('brightness', 'Brightness'),
        audio: audioEvents,
        markers: markerEvents,
        text: sorted(segments.flatMap(segment => {
          const range = eventRange(segment.start, segment.end, bounds);
          return range ? [{ id: `text:${segment.id}`, ...range, label: segment.text }] : [];
        }), (left, right) => left.start - right.start || left.end - right.end),
      },
    },
    scenes,
  };
}
