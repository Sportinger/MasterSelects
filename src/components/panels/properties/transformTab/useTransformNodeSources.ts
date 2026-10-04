import { useTimelineStore } from '../../../../stores/timeline';
import type { OperatorEndpoint } from '../../../../types/operatorGraph';
import { isTransformParameterPath } from '../../../../services/parameterSources/transformParameterTargets';

const EMPTY: ReadonlyMap<string, OperatorEndpoint> = new Map();

/** Active node bindings of the clip's parameters that match `accepts` (path → source endpoint). */
export function useParameterNodeSources(clipId: string, accepts: (path: string) => boolean): ReadonlyMap<string, OperatorEndpoint> {
  const targets = useTimelineStore(state => state.clips.find(item => item.id === clipId)?.nodeGraph?.parameterSources?.targets);
  if (!targets) return EMPTY;
  const sources = new Map<string, OperatorEndpoint>();
  for (const [path, binding] of Object.entries(targets)) {
    if (accepts(path) && binding.source && binding.enabled !== false) sources.set(path, binding.source);
  }
  return sources.size ? sources : EMPTY;
}

/** Active node bindings of the clip's transform properties (path → source endpoint). */
export function useTransformNodeSources(clipId: string): ReadonlyMap<string, OperatorEndpoint> {
  return useParameterNodeSources(clipId, isTransformParameterPath);
}
