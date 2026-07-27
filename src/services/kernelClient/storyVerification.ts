function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readFiniteNumber(
  sources: Array<Record<string, unknown> | undefined>,
  keys: string[],
): number | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (Array.isArray(value)) return value.length;
    }
  }
  return undefined;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function firstRecord(values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord) as Record<string, unknown> | undefined;
}

export function formatStoryVerificationDetails(
  finalSnapshot: unknown,
  report: unknown,
  compileSummary: unknown,
  blueprintSummary: unknown,
): string {
  const snapshotRecord = isRecord(finalSnapshot) ? finalSnapshot : undefined;
  const occupancy = snapshotRecord && isRecord(snapshotRecord.occupancy)
    ? snapshotRecord.occupancy
    : undefined;
  const occupied = occupancy && isRecord(occupancy.occupied)
    ? occupancy.occupied
    : undefined;
  const reportRecord = isRecord(report) ? report : undefined;
  const verified = reportRecord && isRecord(reportRecord.verified)
    ? reportRecord.verified
    : undefined;
  const reportSummary = reportRecord && isRecord(reportRecord.summary)
    ? reportRecord.summary
    : undefined;
  const counts = firstRecord([
    reportSummary?.counts,
    reportRecord?.counts,
    isRecord(compileSummary) ? compileSummary.counts : undefined,
    isRecord(blueprintSummary) ? blueprintSummary.counts : undefined,
  ]);
  const sources = [
    snapshotRecord,
    occupied,
    counts,
    verified,
    reportSummary,
    reportRecord,
    isRecord(compileSummary) ? compileSummary : undefined,
    isRecord(blueprintSummary) ? blueprintSummary : undefined,
  ];
  const clipCount = readFiniteNumber(sources, [
    'totalClips',
    'clipCount',
    'videoClipCount',
    'videoCount',
    'clips',
  ]);
  const occupiedEnd = readFiniteNumber([
    occupied,
    counts,
    verified,
    reportSummary,
    reportRecord,
    isRecord(compileSummary) ? compileSummary : undefined,
    isRecord(blueprintSummary) ? blueprintSummary : undefined,
    snapshotRecord,
  ], [
    'occupiedEndSeconds',
    'endSeconds',
    'durationSeconds',
    'duration',
    'end',
  ]);

  return `${clipCount === undefined ? 'unbekannt' : formatNumber(clipCount)} Clips, `
    + `belegt bis ${occupiedEnd === undefined ? 'unbekannt' : formatNumber(occupiedEnd)}s`;
}

function inlineReport(value: unknown): string | undefined {
  const direct = readString(value);
  if (direct) return direct.replace(/\s+/g, ' ');

  if (Array.isArray(value)) {
    const parts = value.map(inlineReport).filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join('; ') : undefined;
  }

  if (isRecord(value)) {
    for (const key of ['summary', 'assumptions', 'notes', 'message']) {
      const preferred = inlineReport(value[key]);
      if (preferred) return preferred;
    }
    const parts = Object.values(value)
      .map(inlineReport)
      .filter((part): part is string => part !== undefined);
    return parts.length > 0 ? parts.join('; ') : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

export function formatAssumptionNote(blueprintSummary: unknown): string | undefined {
  if (!isRecord(blueprintSummary)) return undefined;
  const report = inlineReport(blueprintSummary.assumptionReport);
  return report ? `Annahmen: ${report}` : undefined;
}
