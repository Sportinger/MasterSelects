import type {
  AgentTimelineEvent,
  AgentTimelineRange,
} from '../../../../types/agentTimeline/manifest';

export function validRange(range: AgentTimelineRange): boolean {
  return Number.isFinite(range.start)
    && Number.isFinite(range.end)
    && range.start >= 0
    && range.end > range.start;
}

export function overlaps(left: AgentTimelineRange, right: AgentTimelineRange): boolean {
  return left.start < right.end && left.end > right.start;
}

export function eventRange(event: AgentTimelineEvent): AgentTimelineRange | null {
  if (event.time.timeDomain !== 'source') return null;
  return event.time.temporalKind === 'point'
    ? null
    : { start: event.time.start, end: event.time.end };
}

export function eventStart(event: AgentTimelineEvent): number {
  return event.time.temporalKind === 'point' ? event.time.time : event.time.start;
}

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function stableSourceLocalId(
  sourceId: string,
  kind: string,
  parts: readonly (string | number)[],
): string {
  const canonical = JSON.stringify([sourceId, kind, ...parts]);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${kind}:${hash.toString(16).padStart(16, '0')}`;
}

export function mergeRanges(ranges: readonly AgentTimelineRange[]): AgentTimelineRange[] {
  const ordered = ranges
    .filter(validRange)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function coverageHoles(
  range: AgentTimelineRange,
  coverage: readonly AgentTimelineRange[],
): AgentTimelineRange[] {
  const holes: AgentTimelineRange[] = [];
  let cursor = range.start;
  for (const covered of mergeRanges(coverage)) {
    const start = Math.max(range.start, covered.start);
    const end = Math.min(range.end, covered.end);
    if (end <= start) continue;
    if (cursor < start) holes.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < range.end) holes.push({ start: cursor, end: range.end });
  return holes;
}

export function sourceIntervalEvents(
  events: readonly AgentTimelineEvent[],
  range: AgentTimelineRange,
): AgentTimelineEvent[] {
  return events.filter((event) => {
    const candidate = eventRange(event);
    return candidate !== null && validRange(candidate) && overlaps(candidate, range);
  });
}

export function normalizedTokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

export function tokenBigrams(tokens: readonly string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    bigrams.add(`${tokens[index]}\u0000${tokens[index + 1]}`);
  }
  return bigrams;
}

export function setSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

