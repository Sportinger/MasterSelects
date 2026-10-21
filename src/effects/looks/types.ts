export type LookCategory =
  | 'editorial'
  | 'print'
  | 'digital'
  | 'analog'
  | 'motion'
  | 'custom';

import type { EffectOperatorGraph } from '../../types/operatorGraph';

export interface LookStackEntry {
  effectId: string;
  params: Record<string, number | boolean | string>;
  enabled: boolean;
  /** The color effect's own graph (recipe or edit), so the Look keeps the math it was made with. */
  operatorGraph?: EffectOperatorGraph;
  /**
   * 'earlier': a stylize effect saved with its earlier recipe (before 2026-10-21, see
   * services/operators/stylizeRecipes.ts); applying the Look recreates that recipe so its saved
   * values keep their look. Absent: the effect's current recipe.
   */
  recipe?: 'earlier';
}
/** Current schema of saved Looks (LookDefinition.schemaVersion). */
export const LOOK_SCHEMA_VERSION = 2 as const;

export interface LookDefinition {
  id: string;
  name: string;
  category: LookCategory;
  thumbnail: { kind: 'generated' };
  stack: LookStackEntry[];
  tags: string[];
  builtIn: boolean;
  /**
   * 2: saved with the 2026-10 color recipes and per-entry graphs. Custom Looks without it were
   * saved earlier; their color effects meant the original color math (see applyLook.ts).
   */
  schemaVersion?: 2;
}
