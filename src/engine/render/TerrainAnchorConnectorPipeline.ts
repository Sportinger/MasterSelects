import shader from './terrainAnchorConnector.wgsl?raw';
import type { TerrainAnchorConnector } from '../../types/terrainAttachment';

function color(value: string): [number, number, number] {
  const hex = value.trim().replace(/^#/, '');
  const normalized = hex.length === 3
    ? hex.split('').map(part => `${part}${part}`).join('')
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return [1, 1, 1];
  return [0, 2, 4].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

export class TerrainAnchorConnectorPipeline {
  private readonly layout: GPUBindGroupLayout;
  private readonly copyPipeline: GPURenderPipeline;
  private readonly linePipeline: GPURenderPipeline;
  private readonly device: GPUDevice;
  private readonly uniformBuffers = new Map<string, GPUBuffer>();

  constructor(device: GPUDevice) {
    this.device = device;
    const module = device.createShaderModule({ label: 'Terrain anchor connector', code: shader });
    this.layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    ] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    this.copyPipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'connectorCopyVertex' },
      fragment: { module, entryPoint: 'connectorCopyFragment', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.linePipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'connectorLineVertex' },
      fragment: {
        module,
        entryPoint: 'connectorLineFragment',
        targets: [{ format: 'rgba8unorm', blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        } }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    connector: TerrainAnchorConnector,
    sampler: GPUSampler,
    background: GPUTextureView,
    output: GPUTextureView,
    start: { x: number; y: number },
    end: { x: number; y: number },
    width: number,
    height: number,
    layerOpacity: number,
    resourceKey: string,
  ): boolean {
    const lineWidth = Math.max(0, connector.width);
    const opacity = Math.max(0, Math.min(1, connector.opacity * layerOpacity));
    if (!Number.isFinite(lineWidth) || lineWidth <= 0 || !Number.isFinite(opacity) || opacity <= 0) return false;
    const dx = end.x - start.x, dy = end.y - start.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx * dx + dy * dy < 1e-10) return false;
    const rgb = color(connector.color);
    const values = new Float32Array([start.x, start.y, end.x, end.y, ...rgb, opacity, width, height, lineWidth, 0]);
    let uniform = this.uniformBuffers.get(resourceKey);
    if (!uniform) {
      uniform = this.device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.uniformBuffers.set(resourceKey, uniform);
    }
    this.device.queue.writeBuffer(uniform, 0, values);
    const group = this.device.createBindGroup({ layout: this.layout, entries: [
      { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: sampler }, { binding: 2, resource: background },
    ] });
    const copyPass = encoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: 'clear', storeOp: 'store' }] });
    copyPass.setPipeline(this.copyPipeline); copyPass.setBindGroup(0, group); copyPass.draw(3); copyPass.end();
    const linePass = encoder.beginRenderPass({ colorAttachments: [{ view: output, loadOp: 'load', storeOp: 'store' }] });
    linePass.setPipeline(this.linePipeline); linePass.setBindGroup(0, group); linePass.draw(6); linePass.end();
    return true;
  }

  destroy(): void {
    for (const uniform of this.uniformBuffers.values()) uniform.destroy();
    this.uniformBuffers.clear();
  }
}
