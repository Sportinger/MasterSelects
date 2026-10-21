// Feedback history of effects that read their own previous output: per effect occurrence and
// size one committed texture (what the effect reads) and one current texture (what it rendered),
// advanced, kept or cleared by frame-history events (seek, loop, reset, recompiled graph).
import { transitionFrameHistory, type FrameHistoryDiscontinuity, type FrameHistoryState } from './frameHistoryTransition';
import { resolveFeedbackHistoryLoop } from './_shared/feedbackParameters';

export interface EffectFrameHistoryContext {
  scopeId: string;
  eventRevision: number;
  discontinuity?: FrameHistoryDiscontinuity;
  ownerRevision: number;
}

export interface FeedbackState {
  committedTexture: GPUTexture;
  committedView: GPUTextureView;
  currentTexture: GPUTexture;
  width: number;
  height: number;
  lifecycle: FrameHistoryState | null;
  lastEventRevision?: number;
  planKey?: string;
  committedRevision: number;
}

export class EffectFeedbackHistory {
  private readonly device: GPUDevice;
  private readonly states = new Map<string, FeedbackState>();

  constructor(device: GPUDevice) {
    this.device = device;
  }

  /** The state of one effect occurrence; a size change starts a fresh history. */
  get(effect: { id: string; type: string }, width: number, height: number, scopeId: string): FeedbackState {
    const key = JSON.stringify([scopeId, effect.id]);
    const existing = this.states.get(key);

    if (existing && existing.width === width && existing.height === height) {
      return existing;
    }

    existing?.committedTexture.destroy();
    existing?.currentTexture.destroy();

    const createTexture = (role: string) => this.device.createTexture({
      label: `effect-feedback-${role}-${effect.type}-${effect.id}`,
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    });
    const committedTexture = createTexture('committed');
    const currentTexture = createTexture('current');

    const state: FeedbackState = {
      committedTexture,
      committedView: committedTexture.createView(),
      currentTexture,
      width,
      height,
      lifecycle: null,
      committedRevision: 0,
    };
    this.states.set(key, state);
    return state;
  }

  /** Advances, keeps or clears the committed frame before the effect reads it. */
  prepare(commandEncoder: GPUCommandEncoder, state: FeedbackState, effect: { params: Record<string, unknown> },
    timelineTimeSeconds: number, frameHistory?: EffectFrameHistoryContext, planKey?: string, rebuiltPipeline = false): void {
    const eventIsNew = frameHistory !== undefined && frameHistory.eventRevision !== state.lastEventRevision;
    const recompiled = planKey !== undefined && state.planKey !== undefined && state.planKey !== planKey;
    const transition = transitionFrameHistory(rebuiltPipeline || recompiled ? null : state.lifecycle, {
      timelineTimeSeconds, ownerRevision: frameHistory?.ownerRevision ?? 0,
      resetRequested: effect.params.reset === true,
      discontinuity: eventIsNew ? frameHistory.discontinuity : undefined,
      loopPolicy: resolveFeedbackHistoryLoop(effect.params),
    });
    state.lifecycle = transition.state;
    state.planKey = planKey ?? state.planKey;
    if (frameHistory) state.lastEventRevision = frameHistory.eventRevision;
    if (transition.action === 'reset') this.clear(commandEncoder, state);
    else if (transition.action === 'advance') {
      commandEncoder.copyTextureToTexture({ texture: state.currentTexture }, { texture: state.committedTexture },
        { width: state.width, height: state.height });
      state.committedRevision += 1;
    }
  }

  /** Keeps the effect's rendered output (a ping or pong target) as the next current frame. */
  copyOutput(commandEncoder: GPUCommandEncoder, state: FeedbackState, outputView: GPUTextureView,
    pingView: GPUTextureView, pongView: GPUTextureView, width: number, height: number, pingTexture?: GPUTexture, pongTexture?: GPUTexture): void {
    const outputTexture = outputView === pingView ? pingTexture : outputView === pongView ? pongTexture : undefined;
    if (outputTexture) commandEncoder.copyTextureToTexture({ texture: outputTexture }, { texture: state.currentTexture }, { width, height });
  }

  destroy(): void {
    for (const state of this.states.values()) {
      state.committedTexture.destroy();
      state.currentTexture.destroy();
    }
    this.states.clear();
  }

  private clear(commandEncoder: GPUCommandEncoder, state: FeedbackState): void {
    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: state.committedView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    state.committedRevision += 1;
  }
}
