import { buildSplatCenters, sortSplatOrderByDepth, multiplyMat4ColumnMajor } from '../../engine/gaussian/core/splatOrderSortCore';
import { GaussianSplatGpuRenderer } from '../../engine/gaussian/core/GaussianSplatGpuRenderer';
import { buildSplatCamera } from '../../engine/gaussian/core/SplatCameraUtils';
import { loadPly } from '../../engine/gaussian/loaders/PlyLoader';
import type { GaussianSplatMetadata } from '../../engine/gaussian/loaders/types';
import type { SolvedCameraPath } from './cameraSolvePoses';

const COLMAP_TO_EDITOR = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);

/** A transient scene using the editor's existing Gaussian renderer and GPU device. */
export class BrushPreviewRenderer {
  private renderer = new GaussianSplatGpuRenderer();
  private context: GPUCanvasContext;
  private bounds: GaussianSplatMetadata['boundingBox'] | null = null;
  private disposed = false;
  private data: Float32Array | null = null;
  private uploadedView = -1;
  private generation = 0;
  private format: GPUTextureFormat;

  private canvas: HTMLCanvasElement;
  private device: GPUDevice;
  constructor(canvas: HTMLCanvasElement, device: GPUDevice) {
    this.canvas = canvas; this.device = device;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('The live preview could not acquire a GPU canvas.');
    this.context = context;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.renderer.initialize(device);
    if (!this.renderer.isInitialized) throw new Error('The live splat renderer could not initialize.');
  }
  async update(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const generation = ++this.generation;
    const asset = await loadPly(new File([bytes], 'training-preview.ply'));
    if (this.disposed || generation !== this.generation) return;
    // Retain the first framing even as densification changes scene bounds.
    this.bounds ??= asset.metadata.boundingBox;
    await this.device.queue.onSubmittedWorkDone();
    if (this.disposed || generation !== this.generation) return;
    this.data = asset.frames[0].buffer.data;
    this.uploadedView = -1;
  }
  render(path: SolvedCameraPath | null, viewIndex: number): void {
    if (this.disposed || !this.bounds || !this.data) return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2, 1280 / Math.max(1, rect.width), 1280 / Math.max(1, rect.height));
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const pose = path?.poses[viewIndex % path.poses.length];
    const center = this.bounds.min.map((value, axis) => (value + this.bounds!.max[axis]) / 2);
    const radius = Math.max(0.1, Math.hypot(...this.bounds.min.map((value, axis) => this.bounds!.max[axis] - value)) / 2);
    const position = pose?.position ?? { x: center[0], y: center[1], z: center[2] + radius * 3 };
    const camera = buildSplatCamera({ position, scale: { x: 1, y: 1 }, rotation: pose?.rotation ?? 0 },
      { nearPlane: 0.001, farPlane: Math.max(1000, radius * 20), fov: path?.fovDegrees ?? 60 }, { width, height });
    if (this.uploadedView !== viewIndex) {
      const count = this.data.length / 14;
      const worldView = pose ? multiplyMat4ColumnMajor(camera.viewMatrix, COLMAP_TO_EDITOR) : camera.viewMatrix;
      const { order } = sortSplatOrderByDepth(buildSplatCenters(this.data, count), worldView, count);
      const sorted = new Float32Array(this.data.length);
      for (let index = 0; index < count; index++) sorted.set(this.data.subarray(order[index] * 14, order[index] * 14 + 14), index * 14);
      if (!this.renderer.uploadScene('training-preview', { data: sorted, splatCount: count })) {
        throw new Error('The live splat snapshot could not be uploaded.');
      }
      this.uploadedView = viewIndex;
    }
    this.renderer.beginFrame();
    const encoder = this.device.createCommandEncoder();
    const rendered = this.renderer.renderToTexture('training-preview', camera, { width, height }, encoder, {
      outputView: this.context.getCurrentTexture().createView(), outputFormat: this.format,
      worldMatrix: pose ? COLMAP_TO_EDITOR : undefined, backgroundColor: '#111111',
      precise: true, sortFrequency: 0, nearPlane: 0.001, farPlane: camera.far,
    });
    if (!rendered) throw new Error('The live splat scene could not be rendered.');
    this.device.queue.submit([encoder.finish()]);
  }
  dispose(): void {
    this.disposed = true; ++this.generation;
    this.context.unconfigure();
    void this.device.queue.onSubmittedWorkDone().catch(() => {}).then(() => this.renderer.dispose());
  }
}
