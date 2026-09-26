import { transitionFrameHistory, type FrameHistoryDiscontinuity, type FrameHistoryState } from './frameHistoryTransition';
import type { ImageOperatorPlan } from '../services/operators/imageOperatorGraph';
import type { ImageGraphPassBatch, ImageGraphPassRuntime } from './ImageGraphPassRuntime';
import type { ResolvedImageGraphExternalResource } from './_shared/imageGraphExternalResources';
import { temporalSmoothResultId } from '../services/operators/temporalSmoothPasses';

interface NodeHistory {
  committed: GPUTexture; committedView: GPUTextureView;
  current: GPUTexture; currentView: GPUTextureView;
  width: number; height: number;
  lifecycle: FrameHistoryState | null; lastEventRevision?: number; planKey?: string;
  revision: number; written: boolean;
}
interface HistoryContext { scopeId: string; eventRevision: number; discontinuity?: FrameHistoryDiscontinuity; ownerRevision: number }

const MAX_HISTORIES = 32;
const BLIT = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@group(0) @binding(0) var source: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  return textureLoad(source, vec2i(position.xy), 0);
}`;

/**
 * Previous results of Temporal Smooth nodes. Each node owns a committed
 * (read this frame) and a current (written this frame) rgba16float texture and
 * follows the same reset/hold/advance policy as effect feedback, so seeks,
 * loops, export starts and graph edits restart from the current frame.
 */
export class TemporalSmoothHistory {
  private readonly device: GPUDevice;
  private readonly states = new Map<string, NodeHistory>();
  private blit?: GPURenderPipeline;
  constructor(device: GPUDevice) { this.device = device; }

  /** Advances or resets every smoothing node of the plan and returns its committed history. */
  prepare(encoder: GPUCommandEncoder, plan: ImageOperatorPlan, effectId: string, width: number, height: number,
    timelineTimeSeconds: number, history?: HistoryContext): Map<string, ResolvedImageGraphExternalResource> {
    const resolved = new Map<string, ResolvedImageGraphExternalResource>();
    for (const descriptor of plan.externalResources ?? []) {
      if (descriptor.kind !== 'temporal-history') continue;
      const key = JSON.stringify([history?.scopeId ?? 'legacy', effectId, descriptor.owner]);
      const state = this.state(key, width, height);
      const eventIsNew = history !== undefined && history.eventRevision !== state.lastEventRevision;
      const recompiled = state.planKey !== undefined && state.planKey !== plan.key;
      const transition = transitionFrameHistory(recompiled ? null : state.lifecycle, {
        timelineTimeSeconds, ownerRevision: history?.ownerRevision ?? 0, resetRequested: false,
        discontinuity: eventIsNew ? history.discontinuity : undefined, loopPolicy: 'reset',
      });
      state.lifecycle = transition.state; state.planKey = plan.key;
      if (history) state.lastEventRevision = history.eventRevision;
      if (transition.action === 'reset') {
        encoder.beginRenderPass({ colorAttachments: [{ view: state.committedView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end();
        state.written = false; state.revision++;
      } else if (transition.action === 'advance' && state.written) {
        encoder.copyTextureToTexture({ texture: state.current }, { texture: state.committed }, { width: state.width, height: state.height });
        state.revision++;
      }
      resolved.set(descriptor.id, { view: state.committedView, identity: `temporal-history:${key}:${state.revision}` });
    }
    return resolved;
  }

  /** Keeps this frame's smoothed results as the next frame's history. */
  commit(encoder: GPUCommandEncoder, plan: ImageOperatorPlan, effectId: string, scopeId: string | undefined,
    runtime: ImageGraphPassRuntime, batch: ImageGraphPassBatch): void {
    for (const descriptor of plan.externalResources ?? []) {
      if (descriptor.kind !== 'temporal-history') continue;
      const state = this.states.get(JSON.stringify([scopeId ?? 'legacy', effectId, descriptor.owner]));
      const result = runtime.getBatchResourceView(batch, temporalSmoothResultId(descriptor.owner));
      if (!state || !result) continue;
      const pipeline = this.pipeline();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: state.currentView, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: result }] }));
      pass.draw(3); pass.end();
      state.written = true;
    }
  }

  private state(key: string, width: number, height: number): NodeHistory {
    const found = this.states.get(key);
    if (found?.width === width && found.height === height) { this.states.delete(key); this.states.set(key, found); return found; }
    if (found) this.retire(found);
    const create = (role: string) => this.device.createTexture({ label: `temporal-smooth-${role}`, size: { width, height }, format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST });
    const committed = create('committed'), current = create('current');
    const state: NodeHistory = { committed, committedView: committed.createView(), current, currentView: current.createView(),
      width, height, lifecycle: null, revision: 0, written: false };
    this.states.delete(key); this.states.set(key, state);
    if (this.states.size > MAX_HISTORIES) {
      const oldest = this.states.keys().next().value!;
      this.retire(this.states.get(oldest)!); this.states.delete(oldest);
    }
    return state;
  }

  /** Commands recorded this frame may still reference replaced textures. */
  private retire(state: NodeHistory) {
    void this.device.queue.onSubmittedWorkDone().then(() => { state.committed.destroy(); state.current.destroy(); }, () => undefined);
  }

  private pipeline(): GPURenderPipeline {
    if (this.blit) return this.blit;
    const module = this.device.createShaderModule({ label: 'temporal-smooth-history', code: BLIT });
    this.blit = this.device.createRenderPipeline({ label: 'temporal-smooth-history', layout: 'auto',
      vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' } });
    return this.blit;
  }

  destroy(): void {
    for (const state of this.states.values()) { state.committed.destroy(); state.current.destroy(); }
    this.states.clear(); this.blit = undefined;
  }
}
