import type { Keyframe } from '../../types/keyframes';
import type { FlockDefinition, FlockDiagnostic } from '../../types/flock';
import type { FlockProgram } from './compiler/flockProgramTypes';

export type FlockRenderConsumer = 'preview' | 'export';

/**
 * Runtime-only data a flock layer carries from the layer builder to the scene
 * renderer. The program is compiled once per definition object; keyframes are
 * the clip's flock-namespace keys in source seconds.
 */
export interface FlockLayerSourceData {
  clipId: string;
  definition: FlockDefinition;
  program: FlockProgram | null;
  diagnostics: FlockDiagnostic[];
  keyframes: Keyframe[];
  /** Simulation source time in seconds (after clip time mapping, before loop). */
  sourceTime: number;
  consumer: FlockRenderConsumer;
}
