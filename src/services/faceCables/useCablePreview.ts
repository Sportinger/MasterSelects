import { useEffect, useState } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { layerBuilder } from '../layerBuilder';
import { renderHostPort } from '../render/renderHostPort';
import { previewFaceCables } from './previewFaceCables';
import { setCablePreview } from './cablePreviewRuntime';
import type { FaceCableConfig } from './cableData';

export function useCablePreview(clipId: string, effectId: string, configs: FaceCableConfig[], active: boolean) {
  // Do not subscribe the inspector to playback ticks when no paused draft is visible.
  const time = useTimelineStore(state => active && !state.isPlaying && !state.isExporting ? state.playheadPosition : null);
  const playing = useTimelineStore(state => state.isPlaying);
  const exporting = useTimelineStore(state => state.isExporting);
  const clipSignature = useTimelineStore(state => {
    if (!active || state.isPlaying || state.isExporting) return '';
    const clip = state.clips.find(c => c.id === clipId);
    return clip ? JSON.stringify([clip.startTime, clip.duration, clip.inPoint, clip.outPoint, clip.speed,
      clip.reversed, clip.transform, clip.parentClipId, clip.sourceRect, clip.is3D, clip.source?.mediaFileId]) : '';
  });
  const frameRate = useMediaStore(state => state.getActiveComposition()?.frameRate ?? 30);
  const keys = useTimelineStore(state => active && !state.isPlaying && !state.isExporting ? state.clipKeyframes.get(clipId) : undefined);
  const environment = useTimelineStore(state => {
    if (!active) return '';
    const p = state.clips.find(c => c.id === clipId)?.effects.find(e => e.id === effectId)?.params;
    return JSON.stringify([p?.sharedWind, p?.faceCollision, p?.globalWindStrength, p?.globalWindYaw, p?.globalWindPitch, p?.globalWindGusts,
      p?.faceShadows, p?.lightHorizontal, p?.lightVertical, p?.shadowStrength, p?.shadowSoftness]);
  });
  const [status, setStatus] = useState('');
  useEffect(() => {
    const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);
    const refresh = () => {
      // Only rendered layers/composites change; leave media/RAM/video-bake caches alone.
      layerBuilder.invalidateCache();
      renderHostPort.clearCompositeCache();
      renderHostPort.requestRender();
    };
    const removed = setCablePreview(clipId, effectId, null);
    if (!active || playing || exporting || !clip || time === null) {
      setStatus(active && playing ? 'Pause playback to preview changes.' : '');
      if (removed) refresh();
      return;
    }
    setStatus('Updating frame preview...');
    // Coalesce slider events; simulate once after a brief pause instead of on every pointer event.
    const timer = setTimeout(() => {
      try {
        const localTime = time - clip.startTime;
        const bakedData = previewFaceCables(clipId, configs, localTime, effectId);
        setCablePreview(clipId, effectId, { time: localTime, bakedData, frameRate });
        setStatus('Draft frame preview - approximate pose. Bake for full motion and export.');
      } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
      refresh();
    }, 80);
    return () => {
      clearTimeout(timer);
      if (setCablePreview(clipId, effectId, null)) refresh();
    };
  }, [clipId, effectId, configs, active, time, playing, exporting, clipSignature, keys, frameRate, environment]);
  return status;
}
