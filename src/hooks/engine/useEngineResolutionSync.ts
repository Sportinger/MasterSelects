import { useEffect } from 'react';
import { Logger } from '../../services/logger';
import { renderHostPort } from '../../services/render/renderHostPort';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timeline';

const log = Logger.create('Engine');

/**
 * While the picture moves (playback or playhead drag) the preview renders at
 * most Full HD: nested comps are already capped at half size during playback,
 * so a 4K main target only multiplies composite/output work without adding
 * detail. Stills keep the chosen preview quality.
 */
const MOTION_MAX_RENDER_WIDTH = 1920;
const MOTION_MAX_RENDER_HEIGHT = 1080;

export function resolvePreviewRenderQuality(
  baseWidth: number,
  baseHeight: number,
  previewQuality: number,
  inMotion: boolean,
): number {
  // Full is an explicit fidelity choice, including during playback and scrubs.
  // Auxiliary camera monitors own their smaller render surfaces independently.
  if (previewQuality >= 1) return previewQuality;
  if (!inMotion || baseWidth <= 0 || baseHeight <= 0) return previewQuality;
  return Math.min(previewQuality, MOTION_MAX_RENDER_WIDTH / baseWidth, MOTION_MAX_RENDER_HEIGHT / baseHeight);
}

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

    let lastResolutionKey = '';
    const updateResolution = () => {
      const timelineState = useTimelineStore.getState();
      if (timelineState.isExporting) return;
      const { baseWidth, baseHeight, previewQuality } = getEngineResolutionConfig();
      const inMotion = timelineState.isPlaying || timelineState.isDraggingPlayhead;
      const quality = resolvePreviewRenderQuality(baseWidth, baseHeight, previewQuality, inMotion);
      const scaledWidth = Math.round(baseWidth * quality);
      const scaledHeight = Math.round(baseHeight * quality);
      const resolutionKey = `${scaledWidth}x${scaledHeight}@${baseWidth}x${baseHeight}`;
      if (resolutionKey === lastResolutionKey) return;
      lastResolutionKey = resolutionKey;

      renderHostPort.setResolution(scaledWidth, scaledHeight, {
        width: baseWidth,
        height: baseHeight,
      });
      log.info(`Resolution set to ${scaledWidth}\u00d7${scaledHeight} (${Math.round(quality * 100)}% of ${baseWidth}\u00d7${baseHeight}${inMotion ? ', motion cap' : ''})`);
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

    const unsubscribeExport = useTimelineStore.subscribe(
      (state) => state.isExporting,
      // Export drives its own render size; force a re-apply afterwards.
      (isExporting) => { if (!isExporting) { lastResolutionKey = ''; updateResolution(); } },
    );

    const unsubscribeMotion = useTimelineStore.subscribe(
      (state) => state.isPlaying || state.isDraggingPlayhead,
      () => updateResolution(),
    );

    return () => {
      unsubscribeActiveComp();
      unsubscribeCompositions();
      unsubscribeSettings();
      unsubscribeExport();
      unsubscribeMotion();
    };
  }, [isEngineReady]);
}
