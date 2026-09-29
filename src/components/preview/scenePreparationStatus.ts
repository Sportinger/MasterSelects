import type { FlockRuntimeStatus } from '../../engine/flock/runtime/flockRuntimeApi';
import type { SceneModelLoadState } from '../../services/render/sceneModelLoadProgress';

export interface ScenePreparationStatus { label: string; detail: string; percent: number | null; error?: boolean }

/** Null percentages mean real activity whose remaining work cannot be measured. */
export function scenePreparationStatus(
  simulations: Array<{ name: string; status: FlockRuntimeStatus | null }>,
  models: SceneModelLoadState[],
): ScenePreparationStatus | null {
  const failure = simulations.find(({ status }) => status && ['invalid', 'unsupported', 'missing-asset'].includes(status.state));
  if (failure) return { label: 'Scene preparation failed', detail: failure.status?.message ?? failure.name, percent: null, error: true };
  const failedModel = models.find(model => model.state === 'error');
  if (failedModel) return { label: 'Model could not be loaded', detail: failedModel.name, percent: null, error: true };
  const loadingModels = models.filter(model => model.state === 'loading');
  if (loadingModels.length) return { label: 'Loading 3D model', detail: loadingModels.map(model => model.name).join(', '), percent: null };
  const pending = simulations.filter(({ status }) => !status || status.state !== 'ready');
  if (!pending.length) return null;
  if (pending.some(({ status }) => !status || status.targetStep <= 0 || ['compiling', 'idle'].includes(status.state))) {
    return { label: 'Preparing 3D scene', detail: pending.map(item => item.name).join(', '), percent: null };
  }
  const target = pending.reduce((sum, item) => sum + item.status!.targetStep, 0);
  const completed = pending.reduce((sum, item) => sum + Math.min(item.status!.step, item.status!.targetStep), 0);
  return { label: 'Preparing simulation', detail: pending.map(item => item.name).join(', '),
    percent: Math.max(0, Math.min(99, Math.floor(completed / target * 100))) };
}
