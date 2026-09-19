export const CABLE_LIGHT_FIELDS = {
  lightHorizontal: { label: 'Horizontal', default: -30, min: -75, max: 75 },
  lightVertical: { label: 'Vertical', default: -35, min: -75, max: 75 },
  shadowStrength: { label: 'Strength', default: 0.65, min: 0, max: 1 },
  shadowSoftness: { label: 'Softness', default: 0.04, min: 0, max: 0.3 },
} as const;
export function cableLightValue(params: Record<string, unknown>, key: keyof typeof CABLE_LIGHT_FIELDS): number {
  const spec = CABLE_LIGHT_FIELDS[key], value = Number(params[key] ?? spec.default);
  return Number.isFinite(value) ? Math.max(spec.min, Math.min(spec.max, value)) : spec.default;
}
