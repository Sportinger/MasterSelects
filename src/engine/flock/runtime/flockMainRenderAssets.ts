import { renderHostPort } from '../../../services/render/renderHostPort';
import { getFlockModelMesh } from '../gpu/flockModelMeshes';
import { getFlockPigmentBinding } from '../gpu/flockPigmentTextures';
import type { FlockRenderAssets } from '../gpu/FlockRenderAssets';

/** Store lookup and asynchronous asset loading stay on the editor host. */
export function flockMainRenderAssets(device: GPUDevice): FlockRenderAssets {
  const changed = () => renderHostPort.requestRender();
  return {
    model(assetId) {
      const state = getFlockModelMesh(assetId, changed);
      return state.status === 'ready' ? { mesh: state.mesh } : {};
    },
    pigment: assetId => getFlockPigmentBinding(device, assetId, changed),
  };
}
