import { useMediaStore } from '../../stores/mediaStore';
import { collectActiveSceneSplatEffectors } from '../../engine/scene/SceneEffectorUtils';
import { resolveRenderableSharedSceneCamera } from '../../engine/scene/SceneCameraUtils';
import { projectNativeSceneLayers, type WorkerGpuNativeSceneProjectionInput } from './workerGpuNativeSceneProjection';

/** Main owns timeline/navigation state; Workers receive the evaluated camera. */
export function projectMainNativeScene(input: WorkerGpuNativeSceneProjectionInput) {
  if (!input.layers.some(layer => layer.visible && layer.opacity > 0 && layer.is3D)) return null;
  if (input.sceneContext && (!input.sceneContext.clips || !input.sceneContext.tracks)) {
    throw new Error('Worker native scene requires the nested composition timeline context');
  }
  if (!input.sceneContext && input.frame.compositionId !== useMediaStore.getState().activeCompositionId) {
    throw new Error('Worker native scene requires its composition camera context');
  }
  if (collectActiveSceneSplatEffectors(input.width, input.height, input.frame.timelineTime, input.sceneContext).length) {
    throw new Error('Worker native scene effector snapshots are not admitted yet');
  }
  const camera = resolveRenderableSharedSceneCamera({ width: input.width, height: input.height }, input.frame.timelineTime, input.sceneContext);
  const projected = projectNativeSceneLayers(input, camera);
  if (!projected) return null;
  const files = useMediaStore.getState().files;
  const assets = new Map<string, import('./workerGpuNativeSceneContract').WorkerGpuNativeSceneAsset>();
  for (const layer of input.layers) {
    if (!layer.visible || layer.opacity <= 0 || !layer.is3D) continue;
    const program = layer.source?.flock?.program;
    if (!program) continue;
    for (const kind of ['image', 'model'] as const) for (const id of program.assets[kind === 'image' ? 'images' : 'models']) {
      const file = files.find(candidate => candidate.id === id);
      if (!file?.url || file.type !== kind) throw new Error(`Worker native scene ${kind} asset '${id}' is unavailable`);
      const previous = assets.get(id);
      if (previous && previous.kind !== kind) throw new Error(`Worker native scene asset '${id}' has conflicting types`);
      assets.set(id, { id, kind, url: file.url, fileName: file.name });
    }
  }
  return { ...projected, source: { ...projected.source, payload: { ...projected.source.payload, assets: [...assets.values()] } } };
}
