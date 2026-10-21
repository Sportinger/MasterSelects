/**
 * Sheen effects saved before the falloff profile and Highlights existed keep their look: the
 * flat-topped band and an even light over dark and bright surfaces.
 */
export function withLegacySheenParams<T extends Record<string, unknown>>(params: T): T {
  if (params.profile !== undefined) return params;
  return { ...params, profile: 'plateau', highlights: params.highlights ?? 0 };
}
