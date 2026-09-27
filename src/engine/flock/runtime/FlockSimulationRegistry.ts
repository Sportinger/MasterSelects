import { renderHostPort } from '../../../services/render/renderHostPort';
import { peekFlockModelMesh } from '../gpu/flockModelMeshes';
import { FlockSimulationRuntime } from './FlockSimulationRuntime';
import { createFlockAudioSampler, getFlockAudioRevision } from './flockAudioSampler';
import { flockMainRenderAssets } from './flockMainRenderAssets';
import { flockRuntime } from './flockRuntimeApi';

export type { FlockSessionEntry } from './FlockSimulationRuntime';

/** Main-thread adapter. Workers instantiate the same runtime with their own host. */
export class FlockSimulationRegistry extends FlockSimulationRuntime {
  constructor() {
    super({
      requestRender: () => renderHostPort.requestRender(),
      renderAssets: flockMainRenderAssets,
      audioSampler: createFlockAudioSampler,
      audioRevision: getFlockAudioRevision,
      modelState: peekFlockModelMesh,
      status: flockRuntime,
    });
  }
}

let registry: FlockSimulationRegistry | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.flockSimulationRegistry) {
    registry = import.meta.hot.data.flockSimulationRegistry;
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
