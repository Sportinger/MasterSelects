/** Stable shape of the authored finite four-yarn passage study. */
export const KNIT_PASSAGE_POINTS = 641;
export const KNIT_PASSAGE_ROWS = 4;
export interface KnitPassageSpec { phase: number; travel: number; follow: boolean }
export function isKnitPassageSpec(value: Record<string, unknown>): boolean {
  return typeof value.phase === 'number' && Number.isFinite(value.phase) && value.phase >= 0 && value.phase <= 1
    && typeof value.travel === 'number' && Number.isFinite(value.travel) && Math.abs(value.travel) <= 10
    && typeof value.follow === 'boolean';
}
