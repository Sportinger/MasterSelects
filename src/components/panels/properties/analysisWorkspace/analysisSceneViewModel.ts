/**
 * Serializable, range-scoped data for one card in the Analysis workspace.
 * The view model deliberately contains references and summaries only: image
 * pixels, media elements, Files, and analysis-cache handles stay with their
 * respective runtime owners.
 */
export type AnalysisSpeakerState = 'active' | 'offscreen' | 'unknown';
export type AnalysisCoverageState = 'complete' | 'partial' | 'missing' | 'unavailable';
export type AnalysisSeverity = 'info' | 'warning' | 'critical';

export interface AnalysisSceneRange {
  /** Inclusive source-time start in seconds. */
  start: number;
  /** Exclusive source-time end in seconds. */
  end: number;
}

export interface AnalysisKeyframeReference {
  /** Source time of the representative frame. */
  sourceTime: number;
  /** Opaque key/reference. Resolving it is intentionally owned by the caller. */
  ref: string;
  alt?: string;
}

export interface AnalysisScenePerson {
  id: string;
  label: string;
  confidence?: number;
  sampleCount?: number;
  /** A small persisted crop reference, never a decoded crop or image URL. */
  cropRef?: string;
  presence?: AnalysisSceneRange;
  /** Source-time appearance ranges clipped to this scene. */
  appearances?: readonly AnalysisSceneRange[];
}

export interface AnalysisSceneSpeakerTurn extends AnalysisSceneRange {
  id: string;
  speakerId?: string;
  speakerLabel: string;
  personId?: string;
  state: AnalysisSpeakerState;
  confidence?: number;
  method?: 'single-face' | 'mouth-motion' | 'model' | 'manual';
}

export interface AnalysisSceneTranscriptWord extends AnalysisSceneRange {
  id: string;
  text: string;
  speakerId?: string;
  speakerLabel?: string;
  confidence?: number;
  needsReview?: boolean;
  emphasis?: number;
}

export interface AnalysisSceneSpeechMarker extends AnalysisSceneRange {
  id: string;
  kind: string;
  confidence?: number;
  wordIds?: readonly string[];
}

export interface AnalysisSceneLabelledSummary {
  label: string;
  detail?: string;
  confidence?: number;
}

export interface AnalysisSceneQualityIssue extends AnalysisSceneRange {
  id: string;
  label: string;
  severity: AnalysisSeverity;
  detail?: string;
}

export interface AnalysisSceneOcrItem extends AnalysisSceneRange {
  id: string;
  text: string;
  kind?: 'subtitle' | 'title' | 'lower-third' | 'sign' | 'unknown';
  confidence?: number;
}

export interface AnalysisSceneDescription {
  text: string;
  provenance?: string;
  confidence?: number;
}

export interface AnalysisSceneCoverage {
  state: AnalysisCoverageState;
  /** An honest explanation of the absent/partial range, if available. */
  detail?: string;
}

export interface AnalysisSceneView {
  id: string;
  boundarySource: 'scene-block' | 'shot-fallback';
  range: AnalysisSceneRange;
  index?: number;
  occurrenceIds?: readonly string[];
  keyframe?: AnalysisKeyframeReference;
  setup?: AnalysisSceneLabelledSummary;
  camera?: AnalysisSceneLabelledSummary;
  focus?: AnalysisSceneLabelledSummary;
  motion?: AnalysisSceneLabelledSummary;
  people: readonly AnalysisScenePerson[];
  speakerTurns: readonly AnalysisSceneSpeakerTurn[];
  transcript: readonly AnalysisSceneTranscriptWord[];
  description?: AnalysisSceneDescription;
  ocr: readonly AnalysisSceneOcrItem[];
  audio?: AnalysisSceneLabelledSummary;
  qualityIssues: readonly AnalysisSceneQualityIssue[];
  coverage: Readonly<Record<string, AnalysisSceneCoverage | undefined>>;
}

export interface AnalysisSceneTranscriptTurn extends AnalysisSceneRange {
  id: string;
  speakerId?: string;
  speakerLabel: string;
  personId?: string;
  state: AnalysisSpeakerState;
  words: readonly AnalysisSceneTranscriptWord[];
}

function validRange(range: AnalysisSceneRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start;
}

/** Half-open overlap: adjoining ranges do not belong to one another. */
export function rangesOverlap(left: AnalysisSceneRange, right: AnalysisSceneRange): boolean {
  return validRange(left) && validRange(right) && left.start < right.end && right.start < left.end;
}

/** Returns a new list; source events are never sorted or modified in place. */
export function assignEventsToScene<T extends AnalysisSceneRange>(
  scene: AnalysisSceneRange,
  events: readonly T[],
): readonly T[] {
  return events.filter(event => rangesOverlap(scene, event));
}

/**
 * Groups only the supplied scene words by their diarized speaker turn. Words
 * without a matching turn retain an explicit, honest speaker label.
 */
export function buildAnalysisSceneTranscriptTurns(
  scene: AnalysisSceneRange,
  words: readonly AnalysisSceneTranscriptWord[],
  speakerTurns: readonly AnalysisSceneSpeakerTurn[],
): readonly AnalysisSceneTranscriptTurn[] {
  const sceneWords = assignEventsToScene(scene, words).toSorted((left, right) => left.start - right.start || left.end - right.end);
  const turns = assignEventsToScene(scene, speakerTurns).toSorted((left, right) => left.start - right.start || left.end - right.end);
  const groups = new Map<string, { turn: AnalysisSceneTranscriptTurn; words: AnalysisSceneTranscriptWord[] }>();

  for (const word of sceneWords) {
    const turn = turns.find(candidate => rangesOverlap(word, candidate));
    const speakerId = turn?.speakerId ?? word.speakerId;
    const speakerLabel = turn?.speakerLabel ?? (word.speakerLabel?.trim() || 'Unknown speaker');
    const key = turn?.id ?? `unmapped:${speakerId ?? speakerLabel}:${word.start}`;
    const existing = groups.get(key);
    if (existing) {
      existing.words.push(word);
      continue;
    }
    groups.set(key, {
      turn: {
        id: key,
        start: Math.max(scene.start, turn?.start ?? word.start),
        end: Math.min(scene.end, turn?.end ?? word.end),
        speakerId,
        speakerLabel,
        personId: turn?.personId,
        state: turn?.state ?? 'unknown',
        words: [],
      },
      words: [word],
    });
  }

  return Array.from(groups.values())
    .map(({ turn, words: groupWords }) => ({
      ...turn,
      start: Math.min(turn.start, groupWords[0]?.start ?? turn.start),
      end: Math.max(turn.end, groupWords.at(-1)?.end ?? turn.end),
      words: groupWords,
    }))
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
}

export function findActiveAnalysisSceneWord(
  words: readonly AnalysisSceneTranscriptWord[],
  sourceTime: number,
): AnalysisSceneTranscriptWord | undefined {
  if (!Number.isFinite(sourceTime)) return undefined;
  return words.find(word => Number.isFinite(word.start) && Number.isFinite(word.end)
    && sourceTime >= word.start && sourceTime < word.end);
}

export function formatAnalysisSceneTime(time: number): string {
  const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
  const hours = Math.floor(safeTime / 3600);
  const minutes = Math.floor((safeTime % 3600) / 60);
  const seconds = safeTime % 60;
  const base = `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${base}` : base;
}
