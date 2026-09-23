import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { effectOperatorGraph, isImageGraphEffectType } from '../../../../services/operators/effectGraphOwner';
import { EFFECT_GRAPH_PARAM } from '../../../../services/operators/effectGraph';
import type { InspectorGraphInput, InspectorGraphResult } from '../../../../services/operators/inspectorGraphQueue';
import { inspectorGraphQueue as queue } from '../../../../services/operators/inspectorGraphClient';

const idle: InspectorGraphResult = {};

/** Values are read directly by controls. Only an authored graph revision needs
 * background normalization; playback and uniform changes reuse its metadata. */
export function useInspectorEffectGraph(effect?: InspectorGraphInput): InspectorGraphResult {
  const image = !!effect && isImageGraphEffectType(effect.type);
  const type = effect?.type;
  const graph = effect?.operatorGraph;
  const legacy = effect?.params[EFFECT_GRAPH_PARAM];
  const key = useMemo(() => JSON.stringify([type, graph ?? legacy ?? null]), [type, graph, legacy]);
  const subscribe = useCallback((listener: () => void) => image && effect
    ? queue.subscribe(key, effect, listener) : () => {}, [key, image]);
  const read = useCallback(() => image ? queue.read(key) : idle, [key, image]);
  const result = useSyncExternalStore(subscribe, read, () => idle);
  const synchronous = useMemo(() => {
    if (!effect || image) return idle;
    try { return { graph: effectOperatorGraph(effect) }; }
    catch (error) { return { error: String(error) }; }
  }, [image, effect]);
  return image ? result : synchronous;
}
