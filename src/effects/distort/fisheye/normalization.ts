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
