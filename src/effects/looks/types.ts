export type LookCategory =
  | 'editorial'
  | 'print'
  | 'digital'
  | 'analog'
  | 'motion'
  | 'custom';

export interface LookStackEntry {
  effectId: string;
  params: Record<string, number | boolean | string>;
  enabled: boolean;
  /**
   * 'earlier': a stylize effect saved with its earlier recipe (before 2026-10-21, see
   * services/operators/stylizeRecipes.ts); applying the Look recreates that recipe so its saved
   * values keep their look. Absent: the effect's current recipe.
   */
  recipe?: 'earlier';
}
export interface LookDefinition {
  id: string;
  name: string;
  category: LookCategory;
  thumbnail: { kind: 'generated' };
  stack: LookStackEntry[];
  tags: string[];
  builtIn: boolean;
}
