import { useMediaStore } from '../../stores/mediaStore';
import { normalizeCompositionRenderSettings, type CompositionRenderSettings } from '../../engine/native3d/pathtrace/contracts/ptTypes';

/** Updates the render settings of a composition; the export takes them over unless it overrides them. */
export function updateCompositionRenderSettings(compositionId: string, patch: Partial<CompositionRenderSettings>): void {
  const state = useMediaStore.getState();
  const composition = state.compositions.find(item => item.id === compositionId);
  if (!composition) return;
  state.updateComposition(compositionId, { renderSettings: normalizeCompositionRenderSettings({ ...composition.renderSettings, ...patch }) });
}
