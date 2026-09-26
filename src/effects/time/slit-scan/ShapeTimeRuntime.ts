import { solveShapeTimeField } from './shapeTimeField';
import { temporalSourceTime, type TemporalClipSource } from '../temporalClipSource';
import { useTrackingStore } from '../../../stores/trackingStore';
import { slitScanNumber } from './parameters';
import { setTemporalStatus } from '../temporalResourcePreparation';
import type { ResolvedImageGraphExternalResource } from '../../_shared/imageGraphExternalResources';
import { SHAPE_TIME_RESOURCE } from '../../../services/operators/slitScanShapeTimeFieldGraph';

export { SHAPE_TIME_RESOURCE };
export class ShapeTimeRuntime {
  private device: GPUDevice;
  private entries = new Map<string, { identity: string; texture: GPUTexture; encoder: GPUCommandEncoder }>();
  constructor(device: GPUDevice) { this.device = device; }
  resolve(key: string, effectId: string, params: Record<string, unknown>, source: TemporalClipSource | undefined,
    encoder: GPUCommandEncoder): ResolvedImageGraphExternalResource {
    const asset = useTrackingStore.getState().assets.find(item => item.id === params.shapeTrackId);
    if (!source || !asset || asset.sourceMediaId !== source.mediaId) throw new Error('Choose a tracked selection belonging to this source video.');
    if (params.stabilizationEnabled !== false && params.stabilizationAssetId) throw new Error('Disable object stabilization for a source-space shape time field.');
    const delay = slitScanNumber(params, 'delay'), factor = slitScanNumber(params, 'timeFactor');
    const anchor = { x: slitScanNumber(params, 'shapeAnchorX'), y: slitScanNumber(params, 'shapeAnchorY') };
    const stretch = slitScanNumber(params, 'shapeStretch'), coherence = slitScanNumber(params, 'shapeCoherence');
    const identity = JSON.stringify([source, asset.id, asset.revision, delay, factor, anchor, stretch, coherence]);
    let entry = this.entries.get(key);
    if (entry?.identity === identity) { entry.encoder = encoder; return { view: entry.texture.createView(), identity }; }
    const now = temporalSourceTime(source, source.localTime);
    const candidates = Array.from({ length: delay > 0 ? 96 : 1 }, (_, i) => {
      const offset = i * delay / 95;
      return { delay: offset, time: temporalSourceTime(source, source.localTime - offset * factor) };
    });
    const width = 64, height = 64;
    const result = solveShapeTimeField(asset.track, now, candidates, width, height, anchor, stretch, coherence);
    // rgba8 is the established time-map contract; error is shown separately, never used as invented geometry.
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < result.values.length; i++) {
      const value = Math.round(result.values[i] * 255); pixels.set([value, value, value, 255], i * 4);
    }
    if (!entry) {
      if (this.entries.size >= 4) {
        const retired = [...this.entries].find(([, value]) => value.encoder !== encoder);
        if (!retired) throw new Error('Shape field budget supports four simultaneous owners.');
        retired[1].texture.destroy(); this.entries.delete(retired[0]);
      }
      entry = { identity, encoder, texture: this.device.createTexture({ size: [width, height], format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }) }; this.entries.set(key, entry);
    }
    this.device.queue.writeTexture({ texture: entry.texture }, pixels, { bytesPerRow: width * 4 }, [width, height]);
    entry.identity = identity; entry.encoder = encoder;
    setTemporalStatus(`${effectId}:shape`, `Recorded-time fit · RMS ${(result.rmsError * 100).toFixed(2)}% · max ${(result.maxError * 100).toFixed(2)}% of image size. Unreachable targets keep the nearest recorded pose.`);
    return { view: entry.texture.createView(), identity };
  }
  destroy() { for (const entry of this.entries.values()) entry.texture.destroy(); this.entries.clear(); }
}
