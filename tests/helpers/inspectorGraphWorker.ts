import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { configureInspectorGraphWorker } from '../../src/services/operators/inspectorGraphClient';
import type { InspectorGraphInput, InspectorGraphResult } from '../../src/services/operators/inspectorGraphQueue';

/** In-process stand-in for `inspectorGraphWorker.ts`: same normalization, answered on a microtask. */
export function installInProcessInspectorGraphWorker(): void {
  configureInspectorGraphWorker(() => new class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror = null;
    terminate() {}
    postMessage({ id, input }: { id: number; input: InspectorGraphInput }) {
      queueMicrotask(() => {
        let result: InspectorGraphResult;
        try { result = { graph: effectOperatorGraph(input, { inspectionOnly: true }) }; } catch (error) { result = { error: String(error) }; }
        this.onmessage?.({ data: { id, ...result } } as MessageEvent);
      });
    }
  }());
}
