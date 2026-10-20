import commonShader from './_shared/commonShader';
import type { FullscreenEffectDefinition } from './types';
import { Logger } from '../services/logger';
import { canScopePipelineErrors } from '../engine/core/gpuPipelineErrorScopes';
import { createCheckedPipeline } from '../engine/core/gpuPipelineGuard';

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
  private readonly failureMessages = new Map<string, string>();
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
    this.failureMessages.delete(id);
  }

  private fail(id: string, signature: string, message: string): void {
    this.failedSignatures.set(id, signature);
    this.failureMessages.set(id, message);
  }

  private create(id: string, effect: FullscreenEffectDefinition, compiledGraph: boolean): void {
    const signature = this.signature(effect);
    const validate = !!this.onPipelineReady && canScopePipelineErrors(this.device);
    try {
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
      const createPipeline = () => this.device.createRenderPipeline({
        label: `effect-${id}-pipeline`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module: shaderModule, entryPoint: 'vertexMain' },
        fragment: { module: shaderModule, entryPoint: effect.entryPoint, targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' },
      });
      // The verdict covers validation, driver compiler (internal) and out-of-memory failures.
      const { pipeline, settled } = validate ? createCheckedPipeline(this.device, createPipeline) : { pipeline: createPipeline(), settled: null };
      const commit = () => {
        this.shaderModules.set(id, shaderModule); this.bindGroupLayouts.set(id, layout); this.pipelines.set(id, pipeline);
        this.signatures.set(id, signature); this.failedSignatures.delete(id); this.failureMessages.delete(id);
      };
      if (!settled) { commit(); return; }
      this.pendingSignatures.set(id, signature);
      // Compiled graph programs must be usable synchronously in this exact frame.
      if (compiledGraph) commit();
      void settled.then(failure => {
        if (this.pendingSignatures.get(id) !== signature) return;
        this.pendingSignatures.delete(id);
        if (failure) {
          if (compiledGraph) this.pipelines.delete(id);
          this.fail(id, signature, failure.message);
          log.error(`Effect pipeline could not be built (${failure.kind}): ${id}; the effect is skipped`, { kind: failure.kind, message: failure.message });
          return;
        }
        commit(); this.onPipelineReady?.();
      });
    } catch (error) {
      this.fail(id, signature, error instanceof Error ? error.message : String(error));
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
  /** Why the current signature of `id` could not be built, if it failed. */
  getFailure(id: string): string | undefined { return this.failedSignatures.has(id) ? this.failureMessages.get(id) : undefined; }
  createBindGroup(id: string, entries: GPUBindGroupEntry[]): GPUBindGroup | null {
    const layout = this.bindGroupLayouts.get(id);
    return layout ? this.device.createBindGroup({ layout, entries }) : null;
  }
  clear(): void {
    this.graphKeys.clear();
    this.pipelines.clear(); this.bindGroupLayouts.clear(); this.shaderModules.clear();
    this.signatures.clear(); this.pendingSignatures.clear(); this.failedSignatures.clear(); this.failureMessages.clear();
  }
  get size(): number { return this.pipelines.size; }
}
