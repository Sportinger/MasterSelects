import { useEffect } from 'react';
import { engine } from '../../engine/WebGPUEngine';
import { Logger } from '../../services/logger';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';

const log = Logger.create('Engine');

function getEngineResolutionConfig(): {
  baseWidth: number;
  baseHeight: number;
  previewQuality: number;
} {
  const { previewQuality } = useSettingsStore.getState();
  const { activeCompositionId, compositions } = useMediaStore.getState();

  if (activeCompositionId) {
    const activeComp = compositions.find(c => c.id === activeCompositionId);
    if (activeComp) {
      return {
        baseWidth: activeComp.width,
        baseHeight: activeComp.height,
        previewQuality,
      };
    }
  }

  const { outputResolution } = useSettingsStore.getState();
  return {
    baseWidth: outputResolution.width,
    baseHeight: outputResolution.height,
    previewQuality,
  };
}

export function useEngineResolutionSync(isEngineReady: boolean): void {
  useEffect(() => {
    if (!isEngineReady) return;

    const updateResolution = () => {
      const { baseWidth, baseHeight, previewQuality } = getEngineResolutionConfig();
      const scaledWidth = Math.round(baseWidth * previewQuality);
      const scaledHeight = Math.round(baseHeight * previewQuality);

      engine.setResolution(scaledWidth, scaledHeight);
      log.info(`Resolution set to ${scaledWidth}\u00d7${scaledHeight} (${previewQuality * 100}% of ${baseWidth}\u00d7${baseHeight})`);
    };

    updateResolution();

    const unsubscribeActiveComp = useMediaStore.subscribe(
      (state) => state.activeCompositionId,
      () => updateResolution()
    );

    const unsubscribeCompositions = useMediaStore.subscribe(
      (state) => state.compositions,
      () => updateResolution()
    );

    const unsubscribeSettings = useSettingsStore.subscribe(
      (state) => state.previewQuality,
      () => updateResolution()
    );

    return () => {
      unsubscribeActiveComp();
      unsubscribeCompositions();
      unsubscribeSettings();
    };
  }, [isEngineReady]);
}
