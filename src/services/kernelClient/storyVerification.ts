function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

export function formatAssumptionNote(storySummary: unknown): string | undefined {
  if (!isRecord(storySummary)) return undefined;
  const report = inlineReport(storySummary.assumptionReport);
  return report ? `Assumed: ${report}` : undefined;
}
