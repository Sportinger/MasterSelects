import commonShader from './_shared/common.wgsl?raw';
import type { FullscreenEffectDefinition } from './types';
import { Logger } from '../services/logger';

const log = Logger.create('EffectPipelineCache');

/** Owns the complete lifecycle of lazily compiled fullscreen GPU pipelines. */
export class EffectPipelineCache {
  private readonly device: GPUDevice;
  private readonly onPipelineReady?: () => void;
  private readonly pipelines = new Map<string, GPURenderPipeline>();
  private readonly bindGroupLayouts = new Map<string, GPUBindGroupLayout>();
  private readonly shaderModules = new Map<string, GPUShaderModule>();
  private readonly signatures = new Map<string, string>();
  private readonly pendingSignatures = new Map<string, string>();
  private readonly failedSignatures = new Map<string, string>();
  private readonly graphKeys = new Set<string>();

  constructor(device: GPUDevice, onPipelineReady?: () => void) {
    this.device = device;
    this.onPipelineReady = onPipelineReady;
  }

  private signature(effect: FullscreenEffectDefinition): string {
    return [
      effect.entryPoint,
      effect.uniformSize,
      effect.usesFeedback === true ? 'feedback' : 'no-feedback',
      effect.glyphAtlas ? 'glyph-atlas' : 'no-glyph-atlas',
      effect.byteTexture ? 'byte-texture' : 'no-byte-texture',
      effect.landmarkPoints === true ? 'landmarks' : 'no-landmarks',
      effect.shader,
    ].join('\u0000');
  }

  private evict(id: string): void {
    this.graphKeys.delete(id);
    this.pipelines.delete(id);
    this.bindGroupLayouts.delete(id);
    this.shaderModules.delete(id);
    this.signatures.delete(id);
    this.pendingSignatures.delete(id);
    this.failedSignatures.delete(id);
  }

  private create(id: string, effect: FullscreenEffectDefinition, compiledGraph: boolean): void {
    const signature = this.signature(effect);
    const validate = !!this.onPipelineReady
      && typeof this.device.pushErrorScope === 'function'
      && typeof this.device.popErrorScope === 'function';
    let validationScopeOpen = false;
    try {
      if (validate) { this.device.pushErrorScope('validation'); validationScopeOpen = true; }
      const shaderModule = this.device.createShaderModule({ label: `effect-${id}`, code: `${commonShader}\n${effect.shader}` });
      const entries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ];
      if (effect.uniformSize > 0) entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
      if (effect.usesFeedback) entries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} });
      if (effect.glyphAtlas) entries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} });
      if (effect.byteTexture) entries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } });
      if (effect.landmarkPoints) entries.push({ binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } });
      const layout = this.device.createBindGroupLayout({ label: `effect-${id}-layout`, entries });
      const pipeline = this.device.createRenderPipeline({
        label: `effect-${id}-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module: shaderModule, entryPoint: 'vertexMain' },
        fragment: { module: shaderModule, entryPoint: effect.entryPoint, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
      const commit = () => {
        this.shaderModules.set(id, shaderModule); this.bindGroupLayouts.set(id, layout); this.pipelines.set(id, pipeline);
        this.signatures.set(id, signature); this.failedSignatures.delete(id);
      };
      if (!validationScopeOpen) { commit(); return; }
      this.pendingSignatures.set(id, signature);
      // Compiled graph programs must be usable synchronously in this exact frame.
      if (compiledGraph) commit();
      validationScopeOpen = false;
      void this.device.popErrorScope().then(error => {
        if (this.pendingSignatures.get(id) !== signature) return;
        this.pendingSignatures.delete(id);
        if (error) {
          if (compiledGraph) this.pipelines.delete(id);
          this.failedSignatures.set(id, signature);
          log.error(`Effect pipeline validation failed: ${id}`, { name: error.constructor?.name ?? 'GPUValidationError', message: error.message });
          return;
        }
        commit(); this.onPipelineReady?.();
      }).catch(error => {
        if (compiledGraph) this.pipelines.delete(id);
        if (this.pendingSignatures.get(id) !== signature) return;
        this.pendingSignatures.delete(id); this.failedSignatures.set(id, signature);
        log.error(`Effect pipeline validation failed: ${id}`, error);
      });
    } catch (error) {
      if (validationScopeOpen) void this.device.popErrorScope().catch(() => undefined);
      this.failedSignatures.set(id, signature);
      log.error(`Failed to create pipeline for ${id}`, error);
    }
  }

  ensure(id: string, effect: FullscreenEffectDefinition, compiledGraph = false): boolean {
    const signature = this.signature(effect);
    if (this.pipelines.has(id) && this.signatures.get(id) === signature) return false;
    if (this.pendingSignatures.get(id) === signature || this.failedSignatures.get(id) === signature) return false;
    this.evict(id);
    if (compiledGraph) {
      if (this.graphKeys.size >= 64) this.evict(this.graphKeys.values().next().value!);
      this.graphKeys.add(id);
    }
    this.create(id, effect, compiledGraph);
    return this.pipelines.has(id);
  }

  getPipeline(id: string): GPURenderPipeline | undefined { return this.pipelines.get(id); }
  getBindGroupLayout(id: string): GPUBindGroupLayout | undefined { return this.bindGroupLayouts.get(id); }
  isPendingOrFailed(id: string): boolean { return this.pendingSignatures.has(id) || this.failedSignatures.has(id); }
  createBindGroup(id: string, entries: GPUBindGroupEntry[]): GPUBindGroup | null {
    const layout = this.bindGroupLayouts.get(id);
    return layout ? this.device.createBindGroup({ layout, entries }) : null;
  }
  clear(): void {
    this.graphKeys.clear();
    this.pipelines.clear(); this.bindGroupLayouts.clear(); this.shaderModules.clear();
    this.signatures.clear(); this.pendingSignatures.clear(); this.failedSignatures.clear();
  }
  get size(): number { return this.pipelines.size; }
}
