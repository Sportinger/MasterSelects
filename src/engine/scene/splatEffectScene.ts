import type { Effect } from '../../types/effects';
import type { SceneOperatorGraph } from '../../types/operatorGraph';
import { defaultSplatGraph } from '../../services/operators/splatGraph';

const initial = defaultSplatGraph(true);
/** Uses the already interpolated effect parameters from the common layer builder. */
export function splatEffectScene(effects: readonly Effect[] | undefined, legacy?: SceneOperatorGraph): SceneOperatorGraph | undefined {
  const effect = effects?.findLast(e => e.enabled && e.type === 'splat-exploration');
  if (!effect) return effects?.some(e => e.type === 'splat-exploration') ? undefined : legacy;
  let graph = effect.operatorGraph ?? initial.graph;
  try { if (!effect.operatorGraph && typeof effect.params.operatorGraph === 'string') graph = JSON.parse(effect.params.operatorGraph); }
  catch { graph = { ...initial.graph, incomplete: 'Invalid saved splat graph.' }; }
  return { graph, params: { ...initial.params, ...effect.params } as SceneOperatorGraph['params'] };
}
