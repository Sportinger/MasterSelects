import { renderScheduler } from '../renderScheduler';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { useTimelineStore } from '../../stores/timeline';
import type { RenderSource, RenderTargetViewportOverride } from '../../types/renderTarget';
import { renderHostPort } from './renderHostPort';

export interface RegisterPreviewTargetOptions {
  id: string;
  name: string;
  source: RenderSource;
  showTransparencyGrid: boolean;
  canvas: HTMLCanvasElement;
  onIndependentRegistered?: () => void;
}

export function registerPreviewTarget({
  id,
  name,
  source,
  showTransparencyGrid,
  canvas,
  onIndependentRegistered,
}: RegisterPreviewTargetOptions): boolean {
  const isIndependent = source.type !== 'activeComp';

  const gpuContext = renderHostPort.registerTargetCanvas(id, canvas);
  if (!gpuContext) return false;

  useRenderTargetStore.getState().registerTarget({
    id,
    name,
    source,
    destinationType: 'canvas',
    enabled: true,
    showTransparencyGrid,
    canvas,
    context: gpuContext,
    window: null,
    isFullscreen: false,
  });

  if (useTimelineStore.getState().isPlaying) {
    renderHostPort.clearVideoCache();
    renderHostPort.clearScrubbingCache();
    renderHostPort.clearCompositeCache();
  }

  if (isIndependent) {
    renderScheduler.register(id);
    onIndependentRegistered?.();
  }

  renderHostPort.requestRender();

  return true;
}

export function unregisterPreviewTarget(id: string, source: RenderSource): void {
  const target = useRenderTargetStore.getState().targets.get(id);
  const isIndependent = source.type !== 'activeComp' || Boolean(target?.viewportOverride);

  if (isIndependent) {
    renderScheduler.unregister(id);
  }
  useRenderTargetStore.getState().unregisterTarget(id);
  renderHostPort.unregisterTargetCanvas(id);
}

export function setPreviewTargetViewportOverride(
  id: string,
  viewportOverride: RenderTargetViewportOverride | null,
): void {
  const store = useRenderTargetStore.getState();
  const target = store.targets.get(id);
  if (!target) return;

  const wasIndependent = target.source.type !== 'activeComp' || Boolean(target.viewportOverride);
  const isIndependent = target.source.type !== 'activeComp' || Boolean(viewportOverride);
  store.setTargetViewportOverride(id, viewportOverride);

  if (!wasIndependent && isIndependent) renderScheduler.register(id);
  if (wasIndependent && !isIndependent) renderScheduler.unregister(id);
  renderHostPort.requestRender();
}

export function setPreviewTargetTransparency(id: string, showTransparencyGrid: boolean): void {
  useRenderTargetStore.getState().setTargetTransparencyGrid(id, showTransparencyGrid);
  renderHostPort.requestRender();
}
