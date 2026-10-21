import { FISHEYE_PARAMS } from './parameters';

export type NormalizedFisheyeParameters = Record<keyof typeof FISHEYE_PARAMS, number | boolean | string>;

function sampleCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (parsed >= 8) return 8;
  if (parsed >= 4) return 4;
  return 1;
}

/** Resolves arbitrary effect params into canonical UI units without mutating persisted values. */
export function normalizeFisheyeParameters(params: Record<string, unknown>): NormalizedFisheyeParameters {
  const normalized = {} as NormalizedFisheyeParameters;
  for (const [id, schema] of Object.entries(FISHEYE_PARAMS)) {
    const key = id as keyof typeof FISHEYE_PARAMS, raw = params[id];
    if (id === 'samples') { normalized[key] = sampleCount(raw); continue; }
    if (schema.type === 'number') {
      let value = typeof raw === 'number' && Number.isFinite(raw) ? raw : schema.default;
      if (schema.min !== undefined) value = Math.max(schema.min, value);
      if (schema.max !== undefined) value = Math.min(schema.max, value);
      normalized[key] = value;
    } else if (schema.type === 'boolean') normalized[key] = raw === false ? false : schema.default;
    else normalized[key] = typeof raw === 'string' && schema.options?.some(option => option.value === raw) ? raw : schema.default;
  }
  return normalized;
}

/** Values the normalizer replaces or clamps, reported instead of applied silently. */
export function fisheyeParameterWarnings(params: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  for (const [id, schema] of Object.entries(FISHEYE_PARAMS)) {
    const raw = params[id];
    if (raw === undefined || id === 'samples') continue;
    if (schema.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) warnings.push(`${id}: ${String(raw)} is not a number; using ${schema.default}.`);
      else if ((schema.min !== undefined && raw < schema.min) || (schema.max !== undefined && raw > schema.max)) {
        warnings.push(`${id}: ${raw} is outside ${schema.min}..${schema.max}; using ${Math.min(schema.max ?? raw, Math.max(schema.min ?? raw, raw))}.`);
      }
    } else if (schema.type === 'select' && !schema.options?.some(option => option.value === raw)) {
      warnings.push(`${id}: "${String(raw)}" is not an option; using ${String(schema.default)}.`);
    }
  }
  const samples = Number(params.samples);
  if (params.samples !== undefined && ![1, 4, 8].includes(samples)) {
    warnings.push(`samples: ${String(params.samples)} is not 1, 4 or 8; using ${samples >= 8 ? 8 : samples >= 4 ? 4 : 1}.`);
  }
  return warnings;
}
