import type { WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';
import { transitionFrameHistory, type FrameHistoryDiscontinuity, type FrameHistoryLoopPolicy, type FrameHistoryState } from '../../effects/frameHistoryTransition';

type AcuarelaAdjustment = NonNullable<WorkerRenderSoftwarePixelEffects['acuarelaAdjustments']>[number];
type Rom1Adjustment = NonNullable<WorkerRenderSoftwarePixelEffects['rom1Adjustments']>[number];

export interface WorkerSoftwareFeedbackFrameMetadata {
  readonly timelineTimeSeconds: number;
  readonly ownerRevision?: string | number;
  readonly eventRevision?: number;
  readonly discontinuity?: FrameHistoryDiscontinuity;
  readonly compositionId?: string;
}

export interface WorkerSoftwareFeedbackStore {
  read(input: {
    readonly scopeId: string;
    readonly feedbackKey: string;
    readonly width: number;
    readonly height: number;
    readonly reset: boolean;
    readonly loopPolicy?: FrameHistoryLoopPolicy;
    readonly frame?: WorkerSoftwareFeedbackFrameMetadata;
  }): Uint8ClampedArray | null;
  write(input: {
    readonly scopeId: string;
    readonly feedbackKey: string;
    readonly width: number;
    readonly height: number;
    readonly reset: boolean;
    readonly pixels: Uint8ClampedArray;
    readonly frame?: WorkerSoftwareFeedbackFrameMetadata;
  }): void;
  deleteScope(scopeId: string): void;
  clear(): void;
}

interface WorkerSoftwareFeedbackEntry {
  readonly width: number;
  readonly height: number;
  committed: Uint8ClampedArray | null;
  current: Uint8ClampedArray | null;
  lifecycle: FrameHistoryState | null;
  lastEventRevision?: number;
}

type WorkerSoftwareFeedbackEffectState =
  | {
      readonly kind: 'acuarela';
      readonly adjustment: AcuarelaAdjustment;
      readonly previous: Uint8ClampedArray | null;
      readonly next: Uint8ClampedArray;
    }
  | {
      readonly kind: 'rom1';
      readonly adjustment: Rom1Adjustment;
      readonly previous: Uint8ClampedArray | null;
      readonly next: Uint8ClampedArray;
    };

export interface WorkerSoftwareFeedbackFrame {
  readonly scopeId: string;
  readonly width: number;
  readonly height: number;
  readonly store: WorkerSoftwareFeedbackStore;
  readonly frame?: WorkerSoftwareFeedbackFrameMetadata;
  readonly effects: readonly WorkerSoftwareFeedbackEffectState[];
}

function clampIndex(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function mix(a: number, b: number, amount: number): number {
  return a * (1 - amount) + b * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash2d(x: number, y: number): number {
  const p2x = x * 127.1 + y * 311.7;
  const p2y = x * 269.5 + y * 183.3;
  return fract(Math.sin(p2x * 12.9898 + p2y * 78.233) * 43758.5453);
}

function noise2d(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = mix(hash2d(ix, iy), hash2d(ix + 1, iy), ux);
  const b = mix(hash2d(ix, iy + 1), hash2d(ix + 1, iy + 1), ux);
  return mix(a, b, uy);
}

function sampleRgba(
  data: Uint8ClampedArray | null,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
): readonly [number, number, number, number] {
  if (!data) return [0, 0, 0, 0];
  const sampleX = clampIndex(Math.round(clamp01(uvX) * (width - 1)), width);
  const sampleY = clampIndex(Math.round(clamp01(uvY) * (height - 1)), height);
  const index = (sampleY * width + sampleX) * 4;
  return [
    data[index] / 255,
    data[index + 1] / 255,
    data[index + 2] / 255,
    data[index + 3] / 255,
  ];
}

function feedbackEdgeMask(uvX: number, uvY: number): number {
  const edge = Math.min(Math.min(uvX, 1 - uvX), Math.min(uvY, 1 - uvY));
  return smoothstep(-0.005, 0.025, edge);
}

function acuarelaNoiseVector(x: number, y: number, time: number): readonly [number, number] {
  const n1 = noise2d(x + time * 0.19, y + time * 0.31);
  const n2 = noise2d(x * 1.173 + 19.17 - time * 0.27, y * 1.173 + 7.31 + time * 0.16);
  return [n1 * 2 - 1, n2 * 2 - 1];
}

function rom1NoiseVector(x: number, y: number, time: number): readonly [number, number] {
  const n1 = noise2d(x + time * 0.071, y + time * 0.113);
  const n2 = noise2d(x * 1.173 + 19.17 - time * 0.097, y * 1.173 + 7.31 + time * 0.053);
  return [n1 * 2 - 1, n2 * 2 - 1];
}

function feedbackFbm(
  x: number,
  y: number,
  time: number,
  vector: (x: number, y: number, time: number) => readonly [number, number],
): readonly [number, number] {
  let sumX = 0;
  let sumY = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let normalizer = 0;

  for (let index = 0; index < 4; index += 1) {
    const octave = vector(x * frequency, y * frequency, time + index * 13.37);
    sumX += octave[0] * amplitude;
    sumY += octave[1] * amplitude;
    normalizer += amplitude;
    frequency *= 2;
    amplitude *= 0.53;
  }
  return normalizer <= 0 ? [0, 0] : [sumX / normalizer, sumY / normalizer];
}

function storeId(scopeId: string, feedbackKey: string, compositionId?: string): string {
  return `${compositionId ?? ''}\u0000${scopeId}\u0000${feedbackKey}`;
}

export function createWorkerSoftwareFeedbackStore(): WorkerSoftwareFeedbackStore {
  const entries = new Map<string, WorkerSoftwareFeedbackEntry>();
  return {
    read(input) {
      const id = storeId(input.scopeId, input.feedbackKey, input.frame?.compositionId);
      let entry = entries.get(id);
      if (!entry || entry.width !== input.width || entry.height !== input.height) {
        entry = { width: input.width, height: input.height, committed: null, current: null, lifecycle: null };
        entries.set(id, entry);
      }
      const eventIsNew = input.frame?.eventRevision !== undefined && input.frame.eventRevision !== entry.lastEventRevision;
      const transition = transitionFrameHistory(entry.lifecycle, {
        timelineTimeSeconds: input.frame?.timelineTimeSeconds ?? 0,
        ownerRevision: input.frame?.ownerRevision ?? 0,
        resetRequested: input.reset,
        discontinuity: eventIsNew ? input.frame?.discontinuity : undefined,
        loopPolicy: input.loopPolicy ?? 'reset',
      });
      entry.lifecycle = transition.state;
      if (input.frame?.eventRevision !== undefined) entry.lastEventRevision = input.frame.eventRevision;
      if (transition.action === 'reset') {
        entry.committed = null;
        entry.current = null;
      } else if (transition.action === 'advance') {
        entry.committed = entry.current;
      }
      return entry.committed;
    },
    write(input) {
      const id = storeId(input.scopeId, input.feedbackKey, input.frame?.compositionId);
      const entry = entries.get(id) ?? { width: input.width, height: input.height, committed: null, current: null, lifecycle: null };
      entry.current = input.pixels;
      entries.set(id, entry);
    },
    deleteScope(scopeId) {
      for (const key of entries.keys()) {
        if (key.split('\u0000')[1] === scopeId) entries.delete(key);
      }
    },
    clear() {
      entries.clear();
    },
  };
}

export function hasWorkerSoftwareFeedbackEffects(pixelEffects: WorkerRenderSoftwarePixelEffects | undefined): boolean {
  return (pixelEffects?.acuarelaAdjustments?.length ?? 0) > 0
    || (pixelEffects?.rom1Adjustments?.length ?? 0) > 0;
}

export function createWorkerSoftwareFeedbackFrame(input: {
  readonly pixelEffects: WorkerRenderSoftwarePixelEffects;
  readonly store: WorkerSoftwareFeedbackStore | undefined;
  readonly scopeId: string;
  readonly width: number;
  readonly height: number;
  readonly frame?: WorkerSoftwareFeedbackFrameMetadata;
}): WorkerSoftwareFeedbackFrame | null {
  if (!input.store) return null;
  const effects: WorkerSoftwareFeedbackEffectState[] = [];
  const createState = <T extends AcuarelaAdjustment | Rom1Adjustment>(
    kind: 'acuarela' | 'rom1',
    adjustment: T,
  ): WorkerSoftwareFeedbackEffectState => ({
    kind,
    adjustment,
    previous: input.store?.read({
      scopeId: input.scopeId,
      feedbackKey: adjustment.feedbackKey,
      width: input.width,
      height: input.height,
      reset: adjustment.reset,
      loopPolicy: adjustment.historyLoop,
      frame: input.frame,
    }) ?? null,
    next: new Uint8ClampedArray(input.width * input.height * 4),
  } as WorkerSoftwareFeedbackEffectState);
  for (const adjustment of input.pixelEffects.acuarelaAdjustments ?? []) {
    effects.push(createState('acuarela', adjustment));
  }
  for (const adjustment of input.pixelEffects.rom1Adjustments ?? []) {
    effects.push(createState('rom1', adjustment));
  }
  return effects.length > 0
    ? { scopeId: input.scopeId, width: input.width, height: input.height, store: input.store, frame: input.frame, effects }
    : null;
}

function applyAcuarelaEffect(input: {
  readonly sourceData: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly uvX: number;
  readonly uvY: number;
  readonly current: readonly [number, number, number, number];
  readonly previous: Uint8ClampedArray | null;
  readonly timelineTime: number;
  readonly adjustment: AcuarelaAdjustment;
}): readonly [number, number, number, number] {
  const params = input.adjustment;
  const density = Math.max(params.density, 0.001);
  const frequency = Math.max(params.detail, 0.001);
  const drivenTime = input.timelineTime * Math.max(params.speed, 0) * 0.75;
  const offset = feedbackFbm(
    input.uvX * density * frequency,
    input.uvY * density * frequency,
    drivenTime,
    acuarelaNoiseVector,
  );
  const offsetX = offset[0] * params.gainX * params.strength * 0.024;
  const offsetY = offset[1] * -params.gainY * params.strength * 0.024;
  const warpedUvX = input.uvX + offsetX;
  const warpedUvY = input.uvY + offsetY;
  const feedback = sampleRgba(input.previous, input.width, input.height, warpedUvX, warpedUvY);
  const edgeMask = feedbackEdgeMask(warpedUvX, warpedUvY);
  const wetSource = sampleRgba(input.sourceData, input.width, input.height, warpedUvX, warpedUvY);
  const smearA = sampleRgba(input.sourceData, input.width, input.height, input.uvX + offsetX * 0.45, input.uvY + offsetY * 0.45);
  const smearB = sampleRgba(input.sourceData, input.width, input.height, input.uvX - offsetX * 0.65, input.uvY - offsetY * 0.65);
  const smearC = sampleRgba(input.sourceData, input.width, input.height, input.uvX - offsetY * 0.5, input.uvY + offsetX * 0.5);
  const gain = Math.max(params.gain, 0) * 0.35;
  const lifted = [
    clamp01(input.current[0] + gain * input.current[3]),
    clamp01(input.current[1] + gain * input.current[3]),
    clamp01(input.current[2] + gain * input.current[3]),
  ];
  const delayed = [
    clamp01(feedback[0] * edgeMask * 0.98),
    clamp01(feedback[1] * edgeMask * 0.98),
    clamp01(feedback[2] * edgeMask * 0.98),
  ];
  const wash = [
    (wetSource[0] + smearA[0] + smearB[0] + smearC[0]) * 0.25,
    (wetSource[1] + smearA[1] + smearB[1] + smearC[1]) * 0.25,
    (wetSource[2] + smearA[2] + smearB[2] + smearC[2]) * 0.25,
  ];
  const warpMix = clamp01(Math.min(params.strength * 0.92, 0.92));
  const feedbackMix = clamp01(Math.min(params.strength * 0.1 + params.opacity * 0.04, 0.14));
  const opacity = clamp01(params.opacity);
  const waterRgb = [0, 1, 2].map((channel) => {
    const warpedCurrent = mix(lifted[channel], wash[channel], warpMix);
    const memory = mix(warpedCurrent, delayed[channel], feedbackMix);
    const paperLimit = Math.max(input.current[channel], wash[channel]) + 0.1 + gain * 2;
    return Math.min(memory, paperLimit);
  });
  const waterAlpha = clamp01(Math.max(input.current[3], feedback[3] * edgeMask * 0.98));
  return [
    mix(input.current[0], waterRgb[0], opacity),
    mix(input.current[1], waterRgb[1], opacity),
    mix(input.current[2], waterRgb[2], opacity),
    mix(input.current[3], waterAlpha, opacity),
  ];
}

function applyRom1Effect(input: {
  readonly sourceData: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly uvX: number;
  readonly uvY: number;
  readonly current: readonly [number, number, number, number];
  readonly previous: Uint8ClampedArray | null;
  readonly timelineTime: number;
  readonly adjustment: Rom1Adjustment;
}): readonly [number, number, number, number] {
  const params = input.adjustment;
  const density = Math.max(params.density, 0.001);
  const frequency = Math.max(params.detail, 0.001);
  const offset = feedbackFbm(
    input.uvX * density * frequency,
    input.uvY * density * frequency,
    input.timelineTime,
    rom1NoiseVector,
  );
  const noiseGain = Math.max(params.speed, 0.001);
  const offsetX = offset[0] * params.gainX * params.strength * 0.005 * noiseGain;
  const offsetY = offset[1] * -params.gainY * params.strength * 0.005 * noiseGain;
  const warpedUvX = input.uvX + offsetX;
  const warpedUvY = input.uvY + offsetY;
  const edgeMask = feedbackEdgeMask(warpedUvX, warpedUvY);
  const feedback = sampleRgba(input.previous, input.width, input.height, warpedUvX, warpedUvY);
  const wetSource = sampleRgba(input.sourceData, input.width, input.height, warpedUvX, warpedUvY);
  const gain = Math.max(params.gain, 0);
  const lifted = [
    clamp01(mix(input.current[0], wetSource[0], 0.18) + gain * input.current[3]),
    clamp01(mix(input.current[1], wetSource[1], 0.18) + gain * input.current[3]),
    clamp01(mix(input.current[2], wetSource[2], 0.18) + gain * input.current[3]),
  ];
  const water = [
    Math.max(lifted[0], feedback[0] * edgeMask * 0.98),
    Math.max(lifted[1], feedback[1] * edgeMask * 0.98),
    Math.max(lifted[2], feedback[2] * edgeMask * 0.98),
    clamp01(Math.max(input.current[3], feedback[3] * edgeMask * 0.98)),
  ];
  const opacity = clamp01(params.opacity);
  return [
    mix(input.current[0], water[0], opacity),
    mix(input.current[1], water[1], opacity),
    mix(input.current[2], water[2], opacity),
    mix(input.current[3], water[3], opacity),
  ];
}

export function applyWorkerSoftwareFeedbackEffects(input: {
  readonly frame: WorkerSoftwareFeedbackFrame | null;
  readonly sourceData: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly current: readonly [number, number, number, number];
  readonly timelineTime: number;
}): readonly [number, number, number, number] {
  if (!input.frame) return input.current;
  const uvX = (input.x + 0.5) / input.width;
  const uvY = (input.y + 0.5) / input.height;
  let output = input.current;
  for (const effect of input.frame.effects) {
    output = effect.kind === 'acuarela'
      ? applyAcuarelaEffect({ ...input, uvX, uvY, current: output, previous: effect.previous, adjustment: effect.adjustment })
      : applyRom1Effect({ ...input, uvX, uvY, current: output, previous: effect.previous, adjustment: effect.adjustment });
    const targetIndex = (input.y * input.width + input.x) * 4;
    effect.next[targetIndex] = Math.max(0, Math.min(255, Math.round(output[0] * 255)));
    effect.next[targetIndex + 1] = Math.max(0, Math.min(255, Math.round(output[1] * 255)));
    effect.next[targetIndex + 2] = Math.max(0, Math.min(255, Math.round(output[2] * 255)));
    effect.next[targetIndex + 3] = Math.max(0, Math.min(255, Math.round(output[3] * 255)));
  }
  return output;
}

export function commitWorkerSoftwareFeedbackFrame(frame: WorkerSoftwareFeedbackFrame | null): void {
  if (!frame) return;
  for (const effect of frame.effects) {
    frame.store.write({
      scopeId: frame.scopeId,
      feedbackKey: effect.adjustment.feedbackKey,
      width: frame.width,
      height: frame.height,
      reset: effect.adjustment.reset,
      pixels: effect.next,
      frame: frame.frame,
    });
  }
}
