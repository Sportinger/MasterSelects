import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import type { TimelineClip } from '../../../types/timeline';
import { effectOperatorGraph, effectOperatorParams } from '../effectGraphOwner';
import { compileGeometryGraph, type GeometryProgram } from './geometryProgram';
import { geometryParameterReader, WEAVE_EFFECT_TYPE, weaveForm, type SimulationClock, type WeaveForm } from './weaveGraph';
import { geometryRateTravel, keyframesBindingsLeave } from './geometryRateTravel';
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
// A saved recipe follows Form (weaveRecipeForm), so the result also depends on the instance's Form.
const resolvedGraphs = new WeakMap<EffectOperatorGraph, { form: unknown; graph: EffectOperatorGraph }>();
const resolvedLegacyGraphs = new WeakMap<Effect, { value: unknown; graph: EffectOperatorGraph }>();
// A Weave without any graph (added in this session, not yet saved) draws its Form's recipe, a pure
// function of Form. Keyframe evaluation hands over a new Effect object every frame, so a cache per
// Effect would rebuild and validate the recipe (161 nodes for Qualle) on every frame.
const resolvedRecipes = new Map<WeaveForm, EffectOperatorGraph>();
function weaveGraphOf(effect: Effect): EffectOperatorGraph {
  const stored = effect.operatorGraph;
  if (!stored && (effect.params.operatorGraph === undefined || effect.params.operatorGraph === '')) {
    const form = weaveForm(effect.params.form);
    let graph = resolvedRecipes.get(form);
    if (!graph) { graph = effectOperatorGraph(effect); resolvedRecipes.set(form, graph); }
    return graph;
  }
  if (!stored) {
    // Legacy parameter graphs differ per effect; none may become the shared default.
    const value = effect.params.operatorGraph, cached = resolvedLegacyGraphs.get(effect);
    if (cached && cached.value === value) return cached.graph;
    const graph = effectOperatorGraph(effect);
    resolvedLegacyGraphs.set(effect, { value, graph });
    return graph;
  }
  const cached = resolvedGraphs.get(stored);
  if (cached && cached.form === effect.params.form) return cached.graph;
  const graph = effectOperatorGraph(effect);
  resolvedGraphs.set(stored, { form: effect.params.form, graph });
  return graph;
}

type ClipTiming = Partial<Pick<TimelineClip, 'inPoint' | 'outPoint' | 'duration' | 'reversed' | 'speed'>>;
/**
 * Cloth runs in the source time of its host clip, like Flock: splitting or trimming a clip
 * continues the motion instead of restarting it. Speed keyframes are not followed yet.
 */
export function weaveSimulationTime(clip: ClipTiming, clipLocalTime: number): number {
  return weaveSimulationClock(clip).toSimulation(clipLocalTime);
}

/** The clip's keyframe time to simulation (source) time and back; keyed forces are sampled through it. */
export function weaveSimulationClock(clip: ClipTiming): SimulationClock {
  const { inPoint, outPoint, duration } = clip;
  if (inPoint === undefined || outPoint === undefined || duration === undefined) return { toSimulation: time => time, toClip: time => time };
  const map = createFlockClipTimeMap({ inPoint, outPoint, duration, reversed: clip.reversed, speed: clip.speed });
  return { toSimulation: map.toSourceTime, toClip: map.toClipLocalTime };
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
  const clipTime = Number.isFinite(time) ? time : 0, clock = weaveSimulationClock(clip), simulationTime = clock.toSimulation(clipTime);
  // Parameter sources drive exposed graph values (Reveal, Weave Speed, …) like any effect parameter.
  const effects = clip.nodeGraph?.parameterSources
    ? applyParameterSourcesToEffects({ ...clip, startTime: clip.startTime ?? 0 } as ParameterSourceClip, keyframes ?? [], clipTime, renderingWeaveEffects(clip))
    : renderingWeaveEffects(clip);
  return effects.flatMap(effect => {
    try {
      // Keyframes use clip time; Time nodes read the composition clock like image graphs. A property a
      // node or the Constant mode drives reads its driven value, not its keyframes (nor a keyed force track).
      const keys = keyframesBindingsLeave(effect, keyframes ?? [], clip.nodeGraph?.parameterSources?.targets);
      const rateTravel = geometryRateTravel(effect, keys, clipTime,
        { clipClockAt: clock.toSimulation, timelineStart: clip.startTime ?? 0 });
      const program = compileGeometryGraph(weaveGraphOf(effect),
        geometryParameterReader(effectOperatorParams(effect), effect.id, keys, clipTime, clock), undefined,
        { time: (clip.startTime ?? 0) + clipTime, simulationTime, ...(rateTravel ? { rateTravel } : {}) });
      return program.render ? [{ effectId: effect.id, source: { type: 'strands' as const, strands: { clipId: clip.id, effectId: effect.id, program } } }] : [];
    } catch {
      return [];
    }
  });
}

/** Preserve the sampled downstream image stack on every generated strand layer. */
export function strandPostProjectionEffects(effects: readonly Effect[], ownerId: string): Effect[] {
  const owner = effects.findIndex(effect => effect.id === ownerId);
  if (owner < 0) return [];
  return effects.slice(owner + 1).filter(effect => effect.enabled && !effect.detached
    && effect.type !== WEAVE_EFFECT_TYPE && effect.type !== 'flocking' && !effect.type.startsWith('audio-'));
}
