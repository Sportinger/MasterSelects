import { useEngineStore } from '../../../stores/engineStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { StatsOverlay } from '../../preview/StatsOverlay';
import './StatsPanel.css';

export function StatsPanel() {
  const stats = useEngineStore((state) => state.engineStats);
  const activeComposition = useMediaStore((state) => (
    state.compositions.find((composition) => composition.id === state.activeCompositionId) ?? null
  ));
  const outputResolution = useSettingsStore((state) => state.outputResolution);
  const resolution = activeComposition
    ? { width: activeComposition.width, height: activeComposition.height }
    : outputResolution;

  return (
    <div className="stats-panel" role="region" aria-label="Stats">
      <StatsOverlay stats={stats} resolution={resolution} expanded />
    </div>
  );
}
