import { effectOperatorGraph } from '../services/operators/effectGraphOwner';
import type { InspectorGraphInput, InspectorGraphResult } from '../services/operators/inspectorGraphQueue';

self.onmessage = (event: MessageEvent<{ id: number; input: InspectorGraphInput }>) => {
  const start = performance.now();
  let result: InspectorGraphResult;
  try {
    // Inspector metadata needs normalized nodes and bindings, not a compiled
    // render program. Runtime compilation retains its complete validation.
    result = { graph: effectOperatorGraph(event.data.input, { inspectionOnly: true }) };
  } catch (error) { result = { error: String(error) }; }
  self.postMessage({ id: event.data.id, ...result, durationMs: performance.now() - start });
};
