import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { TimelineClip } from '../../../types/timeline';
import { effectOperatorGraph, effectOperatorParams } from '../effectGraphOwner';
import { compileGeometryGraph, type GeometryProgram } from './geometryProgram';
import { geometryParameterReader, WEAVE_EFFECT_TYPE } from './weaveGraph';
import { createFlockClipTimeMap } from '../../flock/time/flockTimeMapper';
import { applyParameterSourcesToEffects } from '../../parameterSources/parameterSourceRendering';
import type { ParameterSourceClip } from '../../parameterSources/parameterSourceTargets';

/**
 * Runtime-only strand payload: a geometry program sampled at the frame time.
 * It is plain data, so the Worker render host receives it unchanged and
 * evaluates the curves itself; no per-point arrays cross the thread boundary.
 */
export interface StrandsLayerSourceData { clipId: string; effectId: string; program: GeometryProgram }

/** Resolving a stored graph validates and re-parses it; keep one result per stored revision. */
const resolvedGraphs = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
const resolvedLegacyGraphs = new WeakMap<Effect, { value: unknown; graph: EffectOperatorGraph }>();
function weaveGraphOf(effect: Effect): EffectOperatorGraph {
  const stored = effect.operatorGraph;
  if (!stored) {
    // Legacy parameter graphs differ per effect; none may become the shared default.
    const value = effect.params.operatorGraph, cached = resolvedLegacyGraphs.get(effect);
    if (cached && cached.value === value) return cached.graph;
    const graph = effectOperatorGraph(effect);
    resolvedLegacyGraphs.set(effect, { value, graph });
    return graph;
  }
  let graph = resolvedGraphs.get(stored);
  if (!graph) { graph = effectOperatorGraph(effect); resolvedGraphs.set(stored, graph); }
  return graph;
}

type ClipTiming = Partial<Pick<TimelineClip, 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>>;
/**
 * Cloth runs in the source time of its host clip, like Flock: splitting or trimming a clip
 * continues the motion instead of restarting it. Speed keyframes are not followed yet.
 */
export function weaveSimulationTime(clip: ClipTiming, clipLocalTime: number): number {
  const { inPoint, outPoint, duration } = clip;
  if (inPoint === undefined || outPoint === undefined || duration === undefined) return clipLocalTime;
  return createFlockClipTimeMap({ inPoint, outPoint, duration, reversed: clip.reversed, speed: clip.speed }).toSourceTime(clipLocalTime);
}

export const renderingWeaveEffects = (clip: Pick<TimelineClip, 'effects'>): Effect[] =>
  (clip.effects ?? []).filter(effect => effect.type === WEAVE_EFFECT_TYPE && effect.enabled && !effect.detached);

/**
 * Strand sources of a clip's enabled Weave effects at clip-local `time`. Graphs
 * that cannot be lowered, or whose Strand Render is muted, contribute no layer.
 */
export function buildStrandsLayerSources(clip: Pick<TimelineClip, 'id' | 'effects'> & Partial<Pick<TimelineClip, 'nodeGraph' | 'colorCorrection'>>
  & { startTime?: number } & ClipTiming, time: number,
  keyframes: readonly Keyframe[] | undefined): Array<{ effectId: string; source: { type: 'strands'; strands: StrandsLayerSourceData } }> {
  const clipTime = Number.isFinite(time) ? time : 0, simulationTime = weaveSimulationTime(clip, clipTime);
  // Parameter sources drive exposed graph values (Reveal, Weave Speed, …) like any effect parameter.
  const effects = clip.nodeGraph?.parameterSources
    ? applyParameterSourcesToEffects({ ...clip, startTime: clip.startTime ?? 0 } as ParameterSourceClip, keyframes ?? [], clipTime, renderingWeaveEffects(clip))
    : renderingWeaveEffects(clip);
  return effects.flatMap(effect => {
    try {
      // Keyframes use clip time; Time nodes read the composition clock like image graphs.
      const program = compileGeometryGraph(weaveGraphOf(effect),
        geometryParameterReader(effectOperatorParams(effect), effect.id, [...keyframes ?? []], clipTime), undefined,
        { time: (clip.startTime ?? 0) + clipTime, simulationTime });
      return program.render ? [{ effectId: effect.id, source: { type: 'strands' as const, strands: { clipId: clip.id, effectId: effect.id, program } } }] : [];
    } catch {
      return [];
    }
  });
}
