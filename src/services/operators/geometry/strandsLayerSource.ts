import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { TimelineClip } from '../../../types/timeline';
import { effectOperatorGraph, effectOperatorParams } from '../effectGraphOwner';
import { compileGeometryGraph, type GeometryProgram } from './geometryProgram';
import { geometryParameterReader, WEAVE_EFFECT_TYPE } from './weaveGraph';

/**
 * Runtime-only strand payload: a geometry program sampled at the frame time.
 * It is plain data, so the Worker render host receives it unchanged and
 * evaluates the curves itself; no per-point arrays cross the thread boundary.
 */
export interface StrandsLayerSourceData { clipId: string; effectId: string; program: GeometryProgram }

/** Resolving a stored graph validates and re-parses it; keep one result per stored revision. */
const resolvedGraphs = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
let resolvedDefault: EffectOperatorGraph | undefined;
function weaveGraphOf(effect: Effect): EffectOperatorGraph {
  const stored = effect.operatorGraph;
  if (!stored) return resolvedDefault ??= effectOperatorGraph(effect);
  let graph = resolvedGraphs.get(stored);
  if (!graph) { graph = effectOperatorGraph(effect); resolvedGraphs.set(stored, graph); }
  return graph;
}

export const renderingWeaveEffects = (clip: Pick<TimelineClip, 'effects'>): Effect[] =>
  (clip.effects ?? []).filter(effect => effect.type === WEAVE_EFFECT_TYPE && effect.enabled && !effect.detached);

/**
 * Strand sources of a clip's enabled Weave effects at clip-local `time`. Graphs
 * that cannot be lowered, or whose Strand Render is muted, contribute no layer.
 */
export function buildStrandsLayerSources(clip: Pick<TimelineClip, 'id' | 'effects'>, time: number,
  keyframes: readonly Keyframe[] | undefined): Array<{ effectId: string; source: { type: 'strands'; strands: StrandsLayerSourceData } }> {
  return renderingWeaveEffects(clip).flatMap(effect => {
    try {
      const program = compileGeometryGraph(weaveGraphOf(effect),
        geometryParameterReader(effectOperatorParams(effect), effect.id, [...keyframes ?? []], Number.isFinite(time) ? time : 0));
      return program.render ? [{ effectId: effect.id, source: { type: 'strands' as const, strands: { clipId: clip.id, effectId: effect.id, program } } }] : [];
    } catch {
      return [];
    }
  });
}
