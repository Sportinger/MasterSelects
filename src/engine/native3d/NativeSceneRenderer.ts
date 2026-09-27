import { NativeSceneRuntime } from './NativeSceneRuntime';
import { nativeSceneMainHost } from './sceneRenderer/nativeSceneMainHost';
import type { FlockSimulationRuntime } from '../flock/runtime/FlockSimulationRuntime';

/** Main-thread owner; the same scene runtime is also usable in a render Worker. */
export class NativeSceneRenderer extends NativeSceneRuntime {
  constructor(flockRuntime: () => FlockSimulationRuntime = nativeSceneMainHost.flockRuntime) {
    super({ ...nativeSceneMainHost, flockRuntime });
  }
}

let instance: NativeSceneRenderer | null = import.meta.hot?.data?.nativeSceneRenderer ?? null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (instance) {
    Object.setPrototypeOf(instance, NativeSceneRenderer.prototype);
    instance.setHost(nativeSceneMainHost);
  }
  import.meta.hot.dispose((data) => {
    data.nativeSceneRenderer = instance;
  });
}

export function getNativeSceneRenderer(): NativeSceneRenderer {
  if (!instance) {
    instance = new NativeSceneRenderer();
  }
  return instance;
}
