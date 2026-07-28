export interface TimelineFaceRange {
  start: number;
  end: number;
}

export interface TimelineFaceIdentityRange extends TimelineFaceRange {
  personId: string;
}

export interface TimelineFaceColor {
  css: string;
  rgb: readonly [number, number, number];
}

interface TimelineFaceRangeAnalysisInput {
  faceAnalysis?: {
    people?: readonly {
      id: string;
      appearances?: readonly TimelineFaceRange[];
    }[];
  };
  frames?: readonly {
    timestamp: number;
    faceCount?: number;
    faces?: readonly { personId: string; identityEligible?: boolean }[];
  }[];
  sampleInterval?: number;
}

export interface TimelineFaceRangeClipInput {
  analysis?: TimelineFaceRangeAnalysisInput;
}

export interface TimelineFaceRangeRatio {
  start: number;
  end: number;
}

export interface TimelineFaceIdentityRangeRatio extends TimelineFaceRangeRatio {
  personId: string;
}

const RANGE_EPSILON_SECONDS = 0.001;
const DEFAULT_FRAME_SAMPLE_SECONDS = 0.5;
const FACE_IDENTITY_COLORS: readonly TimelineFaceColor[] = [
  { css: '#f6bd60', rgb: [246, 189, 96] },
  { css: '#4ecdc4', rgb: [78, 205, 196] },
  { css: '#a78bfa', rgb: [167, 139, 250] },
  { css: '#fb7185', rgb: [251, 113, 133] },
  { css: '#60a5fa', rgb: [96, 165, 250] },
  { css: '#34d399', rgb: [52, 211, 153] },
  { css: '#f97316', rgb: [249, 115, 22] },
  { css: '#e879f9', rgb: [232, 121, 249] },
];

function isValidRange(range: TimelineFaceRange): boolean {
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end >= range.start;
}

function mergeRanges(ranges: readonly TimelineFaceRange[]): TimelineFaceRange[] {
  const merged: TimelineFaceRange[] = [];
  for (const range of ranges.filter(isValidRange).toSorted((a, b) => a.start - b.start)) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + RANGE_EPSILON_SECONDS) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function getFrameFaceIdentityRanges(analysis: TimelineFaceRangeAnalysisInput): TimelineFaceIdentityRange[] {
  const sampleSeconds = Math.max(
    RANGE_EPSILON_SECONDS,
    (analysis.sampleInterval ?? DEFAULT_FRAME_SAMPLE_SECONDS * 1000) / 1000,
  );
  const rangesByPerson = new Map<string, TimelineFaceRange[]>();
  for (const frame of analysis.frames ?? []) {
    if (!Number.isFinite(frame.timestamp) || (frame.faceCount ?? 0) <= 0) continue;
    const personIds = frame.faces
      ? frame.faces
        .filter((face) => face.identityEligible !== false)
        .map((face) => face.personId)
        .filter(Boolean)
      : ['face-detected'];
    for (const personId of personIds) {
      const ranges = rangesByPerson.get(personId) ?? [];
      ranges.push({
        start: frame.timestamp - sampleSeconds / 2,
        end: frame.timestamp + sampleSeconds / 2,
      });
      rangesByPerson.set(personId, ranges);
    }
  }
  return [...rangesByPerson.entries()].flatMap(([personId, ranges]) => (
    mergeRanges(ranges).map((range) => ({ ...range, personId }))
  ));
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getTimelineFaceIdentityColor(personId: string): TimelineFaceColor {
  return FACE_IDENTITY_COLORS[stableHash(personId) % FACE_IDENTITY_COLORS.length]!;
}

/**
 * Returns source-time ranges per anonymous person. Compact identity appearances
 * are authoritative; sampled frame detections support clips analyzed by older
 * builds that did not persist the compact summary.
 */
export function collectTimelineFaceIdentityRanges(
  clip: TimelineFaceRangeClipInput,
): TimelineFaceIdentityRange[] {
  const analysis = clip.analysis;
  if (!analysis) return [];

  const people = analysis.faceAnalysis?.people;
  if (people) {
    return people.flatMap((person) => (
      mergeRanges(person.appearances ?? []).map((range) => ({ ...range, personId: person.id }))
    ));
  }
  return getFrameFaceIdentityRanges(analysis);
}

/** Returns source-time regions containing at least one anonymous face. */
export function collectTimelineFaceRanges(clip: TimelineFaceRangeClipInput): TimelineFaceRange[] {
  return mergeRanges(collectTimelineFaceIdentityRanges(clip).map(({ start, end }) => ({ start, end })));
}

export function getTimelineFaceRangeRatios(
  ranges: readonly TimelineFaceRange[],
  sourceIn: number,
  sourceOut: number,
  reversed = false,
): TimelineFaceRangeRatio[] {
  const sourceSpan = Math.max(RANGE_EPSILON_SECONDS, sourceOut - sourceIn);
  const ratios: TimelineFaceRangeRatio[] = [];

  for (const range of ranges) {
    const start = Math.max(sourceIn, range.start);
    const end = Math.min(sourceOut, range.end);
    if (end < start) continue;

    const forwardStart = Math.max(0, Math.min(1, (start - sourceIn) / sourceSpan));
    const forwardEnd = Math.max(forwardStart, Math.min(1, (end - sourceIn) / sourceSpan));
    ratios.push(reversed
      ? { start: 1 - forwardEnd, end: 1 - forwardStart }
      : { start: forwardStart, end: forwardEnd });
  }

  return ratios;
}

export function getTimelineFaceIdentityRangeRatios(
  ranges: readonly TimelineFaceIdentityRange[],
  sourceIn: number,
  sourceOut: number,
  reversed = false,
): TimelineFaceIdentityRangeRatio[] {
  return ranges.flatMap((range) => (
    getTimelineFaceRangeRatios([range], sourceIn, sourceOut, reversed)
      .map((ratio) => ({ ...ratio, personId: range.personId }))
  ));
}
