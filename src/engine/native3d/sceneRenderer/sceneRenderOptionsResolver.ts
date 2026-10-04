import { useMediaStore } from '../../../stores/mediaStore';
import { normalizeCompositionRenderSettings } from '../pathtrace/contracts/ptTypes';
import type { NativeSceneExportFrame, NativeSceneRenderOptions } from './renderOptions';
import { clearNativeSceneExportProgress } from './sceneExportProgress';

let exportFrame: NativeSceneExportFrame | null = null;

/** Set by the exporter around each frame's scene renders (sample batches, sub-samples); null outside export. */
export function setNativeSceneExportFrame(frame: NativeSceneExportFrame | null): void {
  exportFrame = frame;
  clearNativeSceneExportProgress();
}

export function getNativeSceneExportFrame(): NativeSceneExportFrame | null {
  return exportFrame;
}

/** Render options of the main-thread scene renders: the composition's engine and quality, plus the export context. */
export function resolveSceneRenderOptions(compositionId?: string | null): NativeSceneRenderOptions {
  const state = useMediaStore.getState();
  const id = compositionId ?? state.activeCompositionId;
  const composition = id ? state.compositions?.find(item => item.id === id) : undefined;
  return { renderSettings: normalizeCompositionRenderSettings(composition?.renderSettings), ...(exportFrame ? { exportFrame } : {}) };
}
