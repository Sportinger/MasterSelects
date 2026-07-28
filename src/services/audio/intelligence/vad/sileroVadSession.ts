// Silero VAD v5 inference on ONNX Runtime's WASM build. Mirrors the face
// analysis worker: wasm EP only so the session stays reliable and cancellable
// independent of the renderer's WebGPU state.
import * as ort from 'onnxruntime-web/wasm';

ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = 1;

export const SILERO_FRAME_SAMPLES = 512;
export const SILERO_CONTEXT_SAMPLES = 64;
export const SILERO_SAMPLE_RATE = 16_000;
const SILERO_STATE_SHAPE = [2, 1, 128] as const;
const SILERO_STATE_SIZE = 2 * 1 * 128;
const PROGRESS_FRAME_INTERVAL = 200;

export interface SileroVadProcessOptions {
  checkAborted?: () => void;
  onProgress?: (processedFrames: number, totalFrames: number) => void;
}

interface SileroIoNames {
  input: string;
  state: string;
  sr: string;
  output: string;
  stateOut: string;
}

function resolveIoNames(session: ort.InferenceSession): SileroIoNames {
  const inputNames = [...session.inputNames];
  const outputNames = [...session.outputNames];

  const sr = inputNames.find((name) => name.toLowerCase().includes('sr'));
  const state = inputNames.find((name) => name.toLowerCase().includes('state'));
  const input = inputNames.find((name) => name !== sr && name !== state);
  const stateOut = outputNames.find((name) => name.toLowerCase().includes('state'));
  const output = outputNames.find((name) => name !== stateOut);

  if (!sr || !state || !input || !stateOut || !output || inputNames.length !== 3 || outputNames.length !== 2) {
    throw new Error(
      `Silero VAD model IO contract mismatch: inputs [${inputNames.join(', ')}], `
      + `outputs [${outputNames.join(', ')}] (expected input/state/sr -> output/stateN).`,
    );
  }

  return { input, state, sr, output, stateOut };
}

export class SileroVadSession {
  private session: ort.InferenceSession | null;
  private readonly io: SileroIoNames;

  private constructor(session: ort.InferenceSession, io: SileroIoNames) {
    this.session = session;
    this.io = io;
  }

  static async create(modelBytes: ArrayBuffer): Promise<SileroVadSession> {
    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      enableCpuMemArena: false,
      enableMemPattern: false,
    });
    try {
      return new SileroVadSession(session, resolveIoNames(session));
    } catch (error) {
      await session.release().catch(() => undefined);
      throw error;
    }
  }

  // Returns one speech probability per 512-sample frame (the last frame is
  // zero-padded). The recurrent state and 64-sample context are carried across
  // frames as Silero v5 expects.
  async process(pcm: Float32Array, options: SileroVadProcessOptions = {}): Promise<Float32Array> {
    const session = this.session;
    if (!session) {
      throw new Error('Silero VAD session was released.');
    }

    const frameCount = Math.ceil(pcm.length / SILERO_FRAME_SAMPLES);
    const probabilities = new Float32Array(frameCount);
    const state = new Float32Array(SILERO_STATE_SIZE);
    const context = new Float32Array(SILERO_CONTEXT_SAMPLES);
    const frameWithContext = new Float32Array(SILERO_CONTEXT_SAMPLES + SILERO_FRAME_SAMPLES);
    const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(SILERO_SAMPLE_RATE)]), [1]);

    options.checkAborted?.();
    for (let frame = 0; frame < frameCount; frame += 1) {
      frameWithContext.set(context, 0);
      frameWithContext.fill(0, SILERO_CONTEXT_SAMPLES);
      const start = frame * SILERO_FRAME_SAMPLES;
      const slice = pcm.subarray(start, Math.min(start + SILERO_FRAME_SAMPLES, pcm.length));
      frameWithContext.set(slice, SILERO_CONTEXT_SAMPLES);

      const outputs = await session.run({
        [this.io.input]: new ort.Tensor('float32', frameWithContext.slice(), [1, frameWithContext.length]),
        [this.io.state]: new ort.Tensor('float32', state.slice(), [...SILERO_STATE_SHAPE]),
        [this.io.sr]: srTensor,
      });
      options.checkAborted?.();

      const probabilityData = outputs[this.io.output]?.data;
      const stateData = outputs[this.io.stateOut]?.data;
      if (!(probabilityData instanceof Float32Array) || !(stateData instanceof Float32Array)) {
        throw new Error('Silero VAD returned unexpected output tensor types.');
      }
      if (stateData.length !== SILERO_STATE_SIZE) {
        throw new Error(`Silero VAD state output has invalid length ${stateData.length}.`);
      }

      probabilities[frame] = probabilityData[0] ?? 0;
      state.set(stateData);
      context.set(frameWithContext.subarray(frameWithContext.length - SILERO_CONTEXT_SAMPLES));
      const processedFrames = frame + 1;
      if (processedFrames < frameCount && processedFrames % PROGRESS_FRAME_INTERVAL === 0) {
        options.onProgress?.(processedFrames, frameCount);
      }
    }

    options.onProgress?.(frameCount, frameCount);
    return probabilities;
  }

  async release(): Promise<void> {
    const session = this.session;
    this.session = null;
    await session?.release().catch(() => undefined);
  }
}

export async function createSileroVadSession(modelBytes: ArrayBuffer): Promise<SileroVadSession> {
  return SileroVadSession.create(modelBytes);
}
