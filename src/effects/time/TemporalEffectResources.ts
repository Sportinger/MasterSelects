import type { ClipMask } from '../../types/masks';
import type { ResolvedImageGraphExternalResource } from '../_shared/imageGraphExternalResources';
import { useMediaStore } from '../../stores/mediaStore';
import { SLIT_SCAN_PROTECTION_RESOURCE } from '../../services/operators/slitScanProtectionGraph';
import { SLIT_SCAN_TIME_MAP_RESOURCE } from '../../services/operators/slitScanTimeMapGraph';
import { SlitScanMaskRuntime } from './SlitScanMaskRuntime';
import { TimeMapMediaRuntime } from './TimeMapMediaRuntime';
import { isCollectingTemporalPreparations, setTemporalStatus } from './temporalResourcePreparation';
import type { TemporalClipSource } from './temporalClipSource';
import { SourceTemporalRuntime } from './SourceTemporalRuntime';
import { useTimelineStore } from '../../stores/timeline';
import { useTrackingStore } from '../../stores/trackingStore';
import { slitScanStabilization } from './slit-scan/stabilization';

/** Device-local resource ownership for temporal graphs and their node previews. */
export class TemporalEffectResources {
  private masks: SlitScanMaskRuntime;
  private maps: TimeMapMediaRuntime;
  private native: SourceTemporalRuntime;
  constructor(device: GPUDevice, onReady?: () => void) {
    this.masks = new SlitScanMaskRuntime(device);
    this.maps = new TimeMapMediaRuntime(device, onReady);
    this.native = new SourceTemporalRuntime(device, onReady);
  }

  resolveNative(effect: { id: string; type: string; params: Record<string, unknown> },
    scopeId: string, source: TemporalClipSource | undefined, encoder: GPUCommandEncoder) {
    if (!source) throw new Error('Full-resolution temporal sampling requires a source video clip.');
    const media = useMediaStore.getState().files.find(file => file.id === source.mediaId);
    if (!media || media.type !== 'video') throw new Error('Full-resolution source video is unavailable.');
    return this.native.resolve({ key: JSON.stringify([scopeId, effect.id]), effectId: effect.id, media, source,
      horizon: Math.max(0, Math.min(4, Number(effect.params.delay ?? 1))), samples: Number(effect.params.temporalSamples ?? 32),
      nearest: effect.params.temporalInterpolation === 'nearest', encoder, keepPending: useTimelineStore.getState().isPlaying,
      useProxy: useMediaStore.getState().proxyEnabled && !isCollectingTemporalPreparations(),
      stabilization: slitScanStabilization(effect.params, useTrackingStore.getState().assets, source.mediaId, media.width!, media.height!),
      maxEdge: effect.params.temporalResolution === 'native' ? undefined : 160 });
  }

  resolveNamed(resources: Map<string, ResolvedImageGraphExternalResource>, requested: readonly string[],
    effect: { id: string; params: Record<string, unknown> }, scopeId: string,
    time: number, masks: readonly ClipMask[] | undefined, width: number, height: number, encoder: GPUCommandEncoder) {
    const key = JSON.stringify([scopeId, effect.id]);
    if (requested.includes(SLIT_SCAN_TIME_MAP_RESOURCE)) {
      const mediaId = effect.params.mapMediaId;
      let map: ResolvedImageGraphExternalResource | undefined;
      if (typeof mediaId === 'string' && mediaId) {
        const media = useMediaStore.getState().files.find(file => file.id === mediaId);
        if (!media) {
          setTemporalStatus(effect.id, 'Time map asset is missing. Select an available image or video.');
          throw new Error('Time map asset is missing.');
        }
        map = this.maps.resolve(key, effect.id, media, time - Number(effect.params.mapStart ?? 0), encoder);
      }
      resources.set(SLIT_SCAN_TIME_MAP_RESOURCE, map ?? this.masks.resolve('empty-map', '', undefined, width, height, encoder));
    }
    if (requested.includes(SLIT_SCAN_PROTECTION_RESOURCE)) {
      resources.set(SLIT_SCAN_PROTECTION_RESOURCE,
        this.masks.resolve(key, effect.params.protectionMask, masks, width, height, encoder));
    }
  }

  destroy() { this.native.destroy(); this.maps.destroy(); this.masks.destroy(); }
}
