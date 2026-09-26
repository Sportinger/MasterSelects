import { decodeSpaceTime } from './spaceTimeData';
import { slitScanNumber } from './parameters';
import type { SpaceTimeDraw } from '../../../engine/native3d/passes/SpaceTimeSlicePass';
import { useMediaStore } from '../../../stores/mediaStore';

export class SpaceTimeGeometry {
  private device: GPUDevice;
  private encoded?: string;
  private buffer?: GPUBuffer;
  private decoded?: ReturnType<typeof decodeSpaceTime>;
  constructor(device: GPUDevice) { this.device = device; }
  resolve(params: Record<string, unknown>, sourceId: string): SpaceTimeDraw {
    const encoded = String(params.spaceTimeData ?? '');
    const decoded = encoded === this.encoded && this.decoded ? this.decoded : decodeSpaceTime(encoded);
    const media = useMediaStore.getState().files.find(item => item.id === sourceId);
    if (!media || decoded.metadata.sourceId !== sourceId || decoded.metadata.fingerprint !== (media.fileHash ?? '')) {
      throw new Error('The space-time observations belong to a different source. Bake this source again.');
    }
    if (encoded !== this.encoded || !this.buffer) {
      this.destroy();
      this.buffer = this.device.createBuffer({ size: decoded.points.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(this.buffer, 0, decoded.points as Float32Array<ArrayBuffer>);
      this.encoded = encoded; this.decoded = decoded;
    }
    return { buffer: this.buffer, count: decoded.metadata.count, axis: params.spaceTimeAxis === 'y' ? 1 : params.spaceTimeAxis === 'z' ? 2 : 0,
      angle: slitScanNumber(params, 'spaceTimeAngle'), scale: slitScanNumber(params, 'spaceTimeScale'),
      slice: slitScanNumber(params, 'spaceTimeSlice'), thickness: slitScanNumber(params, 'spaceTimeThickness'),
      depth: slitScanNumber(params, 'spaceTimeDepth'), pointSize: slitScanNumber(params, 'spaceTimePointSize') };
  }
  destroy() {
    const old = this.buffer;
    if (old) void Promise.resolve().then(() => this.device.queue.onSubmittedWorkDone()).then(() => old.destroy(), () => old.destroy());
    this.buffer = undefined; this.encoded = undefined; this.decoded = undefined;
  }
}
