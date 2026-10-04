// Preview toolbar: render engine of the active composition's 3D scene and the path tracer's render scale.

import { useMediaStore } from '../../stores/mediaStore';
import {
  normalizeCompositionRenderSettings,
  PT_RENDER_SCALES,
  type CompositionRenderSettings,
  type PtRenderScale,
} from '../../engine/native3d/pathtrace/contracts/ptTypes';

const SCALE_LABEL: Record<PtRenderScale, string> = { 0.5: '½', 0.67: '⅔', 1: '1' };

/** Updates the render settings of a composition; the export takes them over unless it overrides them. */
export function updateCompositionRenderSettings(compositionId: string, patch: Partial<CompositionRenderSettings>): void {
  const state = useMediaStore.getState();
  const composition = state.compositions.find(item => item.id === compositionId);
  if (!composition) return;
  state.updateComposition(compositionId, { renderSettings: normalizeCompositionRenderSettings({ ...composition.renderSettings, ...patch }) });
}

export function PreviewRenderEngineControls({ compositionId }: { compositionId: string | null }) {
  const stored = useMediaStore(state => state.compositions.find(item => item.id === compositionId)?.renderSettings);
  if (!compositionId) return null;
  const settings = normalizeCompositionRenderSettings(stored);
  const pathTraced = settings.engine === 'path-traced';
  return (
    <div className="preview-render-engine" role="group" aria-label="3D render engine">
      <button
        type="button"
        className={`preview-edit-btn preview-render-engine-btn ${pathTraced ? 'active' : ''}`}
        aria-pressed={pathTraced}
        title={pathTraced ? 'Path Traced: switch the 3D scene back to Raster' : 'Raster: switch the 3D scene to Path Traced'}
        onClick={() => updateCompositionRenderSettings(compositionId, { engine: pathTraced ? 'raster' : 'path-traced' })}
      >
        {pathTraced ? 'Path Traced' : 'Raster'}
      </button>
      {pathTraced && PT_RENDER_SCALES.map(scale => (
        <button
          key={scale}
          type="button"
          className={`preview-edit-btn preview-render-scale-btn ${settings.renderScale === scale ? 'active' : ''}`}
          aria-pressed={settings.renderScale === scale}
          aria-label={`Render scale ${scale}`}
          title={`Path tracing render scale ${scale}`}
          onClick={() => updateCompositionRenderSettings(compositionId, { renderScale: scale })}
        >
          {SCALE_LABEL[scale]}
        </button>
      ))}
    </div>
  );
}
