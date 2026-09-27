import { renderHostPort } from '../../../services/render/renderHostPort';
import { peekFlockModelMesh } from '../gpu/flockModelMeshes';
import { FlockSimulationRuntime } from './FlockSimulationRuntime';
import { createFlockAudioSampler, getFlockAudioRevision, getFlockAudioFingerprint } from './flockAudioSampler';
import { flockMainRenderAssets } from './flockMainRenderAssets';
import { flockRuntime } from './flockRuntimeApi';
import type { FlockSimulationHost } from './flockSimulationHost';

export type { FlockSessionEntry } from './FlockSimulationRuntime';

/** Main-thread adapter. Workers instantiate the same runtime with their own host. */
function mainHost(): FlockSimulationHost {
  return {
    requestRender: () => renderHostPort.requestRender(),
    renderAssets: flockMainRenderAssets,
    audioSampler: createFlockAudioSampler,
    audioRevision: getFlockAudioRevision,
    audioFingerprint: getFlockAudioFingerprint,
    modelState: peekFlockModelMesh,
    status: flockRuntime,
  };
}

export class FlockSimulationRegistry extends FlockSimulationRuntime {
  constructor() { super(mainHost()); }
}

let registry: FlockSimulationRegistry | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.flockSimulationRegistry) {
    registry = import.meta.hot.data.flockSimulationRegistry;
    if (registry) {
      Object.setPrototypeOf(registry, FlockSimulationRegistry.prototype);
      registry.setHost(mainHost());
      flockRuntime.setBackend(registry);
    }
  }
  import.meta.hot.dispose((data) => {
    data.flockSimulationRegistry = registry;
  });
}

export function getFlockSimulationRegistry(): FlockSimulationRegistry {
  if (!registry) {
    registry = new FlockSimulationRegistry();
    flockRuntime.setBackend(registry);
  }
  return registry;
}
