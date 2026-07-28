import type { AgentTimelineProvenance } from '../../../../types/agentTimeline/manifest';

export function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function derivationProvenance(
  analyzerId: string,
  analyzerVersion: string,
  input: AgentTimelineProvenance[] | undefined,
): AgentTimelineProvenance[] {
  const copied = (input ?? []).map((entry) => ({ ...entry }));
  copied.push({ kind: 'analyzer', analyzerId, analyzerVersion });
  return copied;
}

export function stableVisualEventId(prefix: string, parts: Array<string | number>): string {
  return `${prefix}:${parts.map((part) => encodeURIComponent(String(part))).join(':')}`;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
