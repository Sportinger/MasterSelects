import * as ort from 'onnxruntime-web';
import { flags } from '../../../engine/featureFlags';
import { requireStemModel } from './modelCatalog';
import type {
  StemModelCatalogEntry,
  StemSeparationWorkerBackendPreference,
  StemSeparationBackend,
  StemSeparationInput,
  StemSeparationWorkerRequest,
  StemSeparationWorkerResponse,
  StemSeparationWorkerStemResult,
} from './types';
import {
  createStemOverlapWindow,
  createStemSegmentStarts,
} from './segmentSchedule';

const FFT_SIZE = 4096;
const HOP_SIZE = 1024;
const TRAINING_SAMPLES = 343_980;
const MODEL_SPEC_BINS = 2048;
const MODEL_SPEC_FRAMES = 336;
const SEGMENT_OVERLAP = 0.25;

ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = 1;

interface Spectrogram {
  real: Float32Array;
  imag: Float32Array;
  numFrames: number;
  numBins: number;
}

interface PreparedDemucsInput {
  waveform: Float32Array;
  magSpec: Float32Array;
}

interface StereoChannels {
  left: Float32Array;
  right: Float32Array;
}

let session: ort.InferenceSession | null = null;
let loadedModel: StemModelCatalogEntry | null = null;
let loadedBackend: StemSeparationBackend | null = null;
const cancelledJobs = new Set<string>();
const fftTwiddles = new Map<number, { real: Float32Array; imag: Float32Array }>();
const ifftTwiddles = new Map<number, { real: Float32Array; imag: Float32Array }>();
const hannWindows = new Map<number, Float32Array>();

function post(message: StemSeparationWorkerResponse, transfer?: Transferable[]): void {
  self.postMessage(message, { transfer: transfer ?? [] });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function concatChunksToArrayBuffer(chunks: readonly Uint8Array[], totalBytes: number): ArrayBuffer {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function getNavigatorGpu(): GPU | undefined {
  return (self.navigator as Navigator & { gpu?: GPU }).gpu;
}

function getHannWindow(size: number): Float32Array {
  const cached = hannWindows.get(size);
  if (cached) return cached;

  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
  }
  hannWindows.set(size, window);
  return window;
}

function buildTwiddles(size: number, inverse: boolean): { real: Float32Array; imag: Float32Array } {
  const cache = inverse ? ifftTwiddles : fftTwiddles;
  const cached = cache.get(size);
  if (cached) return cached;

  const real = new Float32Array(size / 2);
  const imag = new Float32Array(size / 2);
  const direction = inverse ? 1 : -1;
  for (let index = 0; index < size / 2; index += 1) {
    const angle = (direction * 2 * Math.PI * index) / size;
    real[index] = Math.cos(angle);
    imag[index] = Math.sin(angle);
  }

  const twiddles = { real, imag };
  cache.set(size, twiddles);
  return twiddles;
}

function bitReverse(value: number, bits: number): number {
  let reversed = 0;
  let remaining = value;
  for (let bit = 0; bit < bits; bit += 1) {
    reversed = (reversed << 1) | (remaining & 1);
    remaining >>= 1;
  }
  return reversed;
}

function runFft(
  realOut: Float32Array,
  imagOut: Float32Array,
  realIn: Float32Array,
  imagIn: Float32Array | null,
  size: number,
  inverse: boolean,
): void {
  const bits = Math.log2(size) | 0;
  const twiddles = buildTwiddles(size, inverse);

  for (let index = 0; index < size; index += 1) {
    const sourceIndex = bitReverse(index, bits);
    realOut[index] = realIn[sourceIndex] ?? 0;
    imagOut[index] = imagIn?.[sourceIndex] ?? 0;
  }

  for (let blockSize = 2; blockSize <= size; blockSize *= 2) {
    const halfSize = blockSize / 2;
    const step = size / blockSize;
    for (let blockStart = 0; blockStart < size; blockStart += blockSize) {
      for (let offset = 0; offset < halfSize; offset += 1) {
        const twiddleIndex = offset * step;
        const twiddleReal = twiddles.real[twiddleIndex] ?? 0;
        const twiddleImag = twiddles.imag[twiddleIndex] ?? 0;
        const evenIndex = blockStart + offset;
        const oddIndex = evenIndex + halfSize;
        const evenReal = realOut[evenIndex] ?? 0;
        const evenImag = imagOut[evenIndex] ?? 0;
        const oddReal = (realOut[oddIndex] ?? 0) * twiddleReal - (imagOut[oddIndex] ?? 0) * twiddleImag;
        const oddImag = (realOut[oddIndex] ?? 0) * twiddleImag + (imagOut[oddIndex] ?? 0) * twiddleReal;
        realOut[evenIndex] = evenReal + oddReal;
        imagOut[evenIndex] = evenImag + oddImag;
        realOut[oddIndex] = evenReal - oddReal;
        imagOut[oddIndex] = evenImag - oddImag;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      realOut[index] /= size;
      imagOut[index] /= size;
    }
  }
}

function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array {
  const length = signal.length;
  const output = new Float32Array(padLeft + length + padRight);

  for (let index = 0; index < padLeft; index += 1) {
    output[index] = signal[Math.min(padLeft - index, length - 1)] ?? 0;
  }
  output.set(signal, padLeft);
  for (let index = 0; index < padRight; index += 1) {
    output[padLeft + length + index] = signal[Math.max(0, length - 2 - index)] ?? 0;
  }

  return output;
}

function stft(signal: Float32Array, fftSize: number, hopSize: number): Spectrogram {
  const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2 + 1;
  const window = getHannWindow(fftSize);
  const scale = 1 / Math.sqrt(fftSize);
  const real = new Float32Array(numFrames * numBins);
  const imag = new Float32Array(numFrames * numBins);
  const frameReal = new Float32Array(fftSize);
  const frameImag = new Float32Array(fftSize);
  const windowedFrame = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame += 1) {
    const start = frame * hopSize;
    for (let index = 0; index < fftSize; index += 1) {
      windowedFrame[index] = (signal[start + index] ?? 0) * (window[index] ?? 0);
    }
    runFft(frameReal, frameImag, windowedFrame, null, fftSize, false);

    const outputOffset = frame * numBins;
    for (let bin = 0; bin < numBins; bin += 1) {
      real[outputOffset + bin] = (frameReal[bin] ?? 0) * scale;
      imag[outputOffset + bin] = (frameImag[bin] ?? 0) * scale;
    }
  }

  return { real, imag, numFrames, numBins };
}

function istft(
  specReal: Float32Array,
  specImag: Float32Array,
  numFrames: number,
  numBins: number,
  fftSize: number,
  hopSize: number,
  outputLength: number,
): Float32Array {
  const output = new Float32Array(outputLength);
  const windowSum = new Float32Array(outputLength);
  const window = getHannWindow(fftSize);
  const scale = Math.sqrt(fftSize);
  const fullReal = new Float32Array(fftSize);
  const fullImag = new Float32Array(fftSize);
  const frameReal = new Float32Array(fftSize);
  const frameImag = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame += 1) {
    fullReal.fill(0);
    fullImag.fill(0);
    for (let bin = 0; bin < numBins; bin += 1) {
      const sourceIndex = frame * numBins + bin;
      fullReal[bin] = specReal[sourceIndex] ?? 0;
      fullImag[bin] = specImag[sourceIndex] ?? 0;
    }
    for (let bin = 1; bin < numBins - 1; bin += 1) {
      fullReal[fftSize - bin] = fullReal[bin] ?? 0;
      fullImag[fftSize - bin] = -(fullImag[bin] ?? 0);
    }

    runFft(frameReal, frameImag, fullReal, fullImag, fftSize, true);
    const start = frame * hopSize;
    for (let index = 0; index < fftSize && start + index < outputLength; index += 1) {
      const windowValue = window[index] ?? 0;
      output[start + index] += (frameReal[index] ?? 0) * windowValue * scale;
      windowSum[start + index] += windowValue * windowValue;
    }
  }

  for (let index = 0; index < outputLength; index += 1) {
    const weight = windowSum[index] ?? 0;
    if (weight > 1e-8) {
      output[index] /= weight;
    }
  }

  return output;
}

function prepareModelInput(leftChannel: Float32Array, rightChannel: Float32Array): PreparedDemucsInput {
  const paddedLeft = new Float32Array(TRAINING_SAMPLES);
  const paddedRight = new Float32Array(TRAINING_SAMPLES);
  paddedLeft.set(leftChannel.subarray(0, Math.min(leftChannel.length, TRAINING_SAMPLES)));
  paddedRight.set(rightChannel.subarray(0, Math.min(rightChannel.length, TRAINING_SAMPLES)));

  const expectedFrames = Math.ceil(TRAINING_SAMPLES / HOP_SIZE);
  const padLeft = Math.floor(HOP_SIZE / 2) * 3;
  const padRight = padLeft + expectedFrames * HOP_SIZE - TRAINING_SAMPLES;
  const centeredPad = FFT_SIZE / 2;
  const stftLeft = stft(
    reflectPad(reflectPad(paddedLeft, padLeft, padRight), centeredPad, centeredPad),
    FFT_SIZE,
    HOP_SIZE,
  );
  const stftRight = stft(
    reflectPad(reflectPad(paddedRight, padLeft, padRight), centeredPad, centeredPad),
    FFT_SIZE,
    HOP_SIZE,
  );

  const magSpec = new Float32Array(4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES);
  const frameOffset = 2;
  for (let frame = 0; frame < MODEL_SPEC_FRAMES; frame += 1) {
    const sourceFrame = frame + frameOffset;
    for (let bin = 0; bin < MODEL_SPEC_BINS; bin += 1) {
      const sourceIndex = sourceFrame * stftLeft.numBins + bin;
      const outputIndex = bin * MODEL_SPEC_FRAMES + frame;
      magSpec[outputIndex] = stftLeft.real[sourceIndex] ?? 0;
      magSpec[MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + outputIndex] = stftLeft.imag[sourceIndex] ?? 0;
      magSpec[2 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + outputIndex] = stftRight.real[sourceIndex] ?? 0;
      magSpec[3 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + outputIndex] = stftRight.imag[sourceIndex] ?? 0;
    }
  }

  const waveform = new Float32Array(2 * TRAINING_SAMPLES);
  waveform.set(paddedLeft, 0);
  waveform.set(paddedRight, TRAINING_SAMPLES);
  return { waveform, magSpec };
}

function resampleChannel(channel: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) {
    return new Float32Array(channel);
  }

  const outputLength = Math.max(1, Math.round((channel.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(channel.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    output[index] = (channel[leftIndex] ?? 0) * (1 - mix) + (channel[rightIndex] ?? 0) * mix;
  }
  return output;
}

function normalizeToModelStereo(input: StemSeparationInput, model: StemModelCatalogEntry): StereoChannels {
  if (input.channelCount <= 0 || input.channels.length <= 0) {
    throw new Error('Stem separation input has no audio channels.');
  }
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('Stem separation input has an invalid sample rate.');
  }

  const leftSource = input.channels[0];
  const rightSource = input.channels[1] ?? input.channels[0];
  if (!leftSource || !rightSource || input.frameCount <= 0) {
    throw new Error('Stem separation input has no audio samples.');
  }

  return {
    left: resampleChannel(leftSource, input.sampleRate, model.inputSampleRate),
    right: resampleChannel(rightSource, input.sampleRate, model.inputSampleRate),
  };
}

function frequencyOutputToSpecs(freqOutput: Float32Array): StereoChannels[] {
  const specs: StereoChannels[] = [];
  const channelsPerStem = 4;
  const planeSize = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;

  for (let stemIndex = 0; stemIndex < 4; stemIndex += 1) {
    const leftReal = new Float32Array(planeSize);
    const leftImag = new Float32Array(planeSize);
    const rightReal = new Float32Array(planeSize);
    const rightImag = new Float32Array(planeSize);

    for (let frame = 0; frame < MODEL_SPEC_FRAMES; frame += 1) {
      for (let bin = 0; bin < MODEL_SPEC_BINS; bin += 1) {
        const sourceOffset = stemIndex * channelsPerStem * planeSize;
        const outputIndex = bin * MODEL_SPEC_FRAMES + frame;
        leftReal[outputIndex] = freqOutput[sourceOffset + outputIndex] ?? 0;
        leftImag[outputIndex] = freqOutput[sourceOffset + planeSize + outputIndex] ?? 0;
        rightReal[outputIndex] = freqOutput[sourceOffset + 2 * planeSize + outputIndex] ?? 0;
        rightImag[outputIndex] = freqOutput[sourceOffset + 3 * planeSize + outputIndex] ?? 0;
      }
    }

    const leftPadded = padFrequencySpec(leftReal, leftImag);
    const rightPadded = padFrequencySpec(rightReal, rightImag);
    const paddedFrames = MODEL_SPEC_FRAMES + 4;
    const paddedBins = MODEL_SPEC_BINS + 1;
    const istftLength = (paddedFrames - 1) * HOP_SIZE + FFT_SIZE;
    const totalOffset = FFT_SIZE / 2 + Math.floor(HOP_SIZE / 2) * 3;
    const leftFull = istft(leftPadded.real, leftPadded.imag, paddedFrames, paddedBins, FFT_SIZE, HOP_SIZE, istftLength);
    const rightFull = istft(rightPadded.real, rightPadded.imag, paddedFrames, paddedBins, FFT_SIZE, HOP_SIZE, istftLength);
    specs.push({
      left: new Float32Array(leftFull.subarray(totalOffset, totalOffset + TRAINING_SAMPLES)),
      right: new Float32Array(rightFull.subarray(totalOffset, totalOffset + TRAINING_SAMPLES)),
    });
  }

  return specs;
}

function padFrequencySpec(real: Float32Array, imag: Float32Array): { real: Float32Array; imag: Float32Array } {
  const paddedBins = MODEL_SPEC_BINS + 1;
  const paddedFrames = MODEL_SPEC_FRAMES + 4;
  const paddedReal = new Float32Array(paddedFrames * paddedBins);
  const paddedImag = new Float32Array(paddedFrames * paddedBins);

  for (let frame = 0; frame < MODEL_SPEC_FRAMES; frame += 1) {
    for (let bin = 0; bin < MODEL_SPEC_BINS; bin += 1) {
      const sourceIndex = bin * MODEL_SPEC_FRAMES + frame;
      const destinationIndex = (frame + 2) * paddedBins + bin;
      paddedReal[destinationIndex] = real[sourceIndex] ?? 0;
      paddedImag[destinationIndex] = imag[sourceIndex] ?? 0;
    }
  }

  return { real: paddedReal, imag: paddedImag };
}

function getTensorData(tensor: ort.Tensor | undefined): Float32Array | null {
  if (!tensor || tensor.type !== 'float32') {
    return null;
  }
  return tensor.data as Float32Array;
}

function findDemucsOutputs(results: Record<string, ort.Tensor>): {
  timeData: Float32Array;
  timeShape: number[];
  freqData: Float32Array | null;
} {
  let timeData: Float32Array | null = null;
  let timeShape: number[] | null = null;
  let freqData: Float32Array | null = null;

  for (const tensor of Object.values(results)) {
    const dims = tensor.dims.map(Number);
    const data = getTensorData(tensor);
    if (!data) continue;

    if (dims.length === 4 && dims[2] === 2) {
      timeData = data;
      timeShape = dims;
    } else if (dims.length === 5 && dims[2] === 4) {
      freqData = data;
    }
  }

  if (!timeData || !timeShape) {
    throw new Error('Stem model did not return a time-domain output tensor.');
  }

  return { timeData, timeShape, freqData };
}

function throwIfCancelled(jobId: string): void {
  if (cancelledJobs.has(jobId)) {
    const error = new Error('Stem separation was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

async function createOrtSession(
  source: string | ArrayBuffer,
  options: ort.InferenceSession.SessionOptions,
): Promise<ort.InferenceSession> {
  if (typeof source === 'string') {
    return ort.InferenceSession.create(source, options);
  }
  return ort.InferenceSession.create(source, options);
}

async function loadModelFromSource(
  modelId: string,
  source: string | ArrayBuffer,
  backendPreference: StemSeparationWorkerBackendPreference = 'auto',
): Promise<void> {
  const model = requireStemModel(modelId);
  const canUseWebGpu = model.supportedBackends.includes('webgpu') && Boolean(getNavigatorGpu());
  const preferWebGpu = canUseWebGpu && (
    backendPreference === 'webgpu' ||
    (backendPreference === 'auto' && flags.stemSeparationWebGPU)
  );
  const baseOptions: ort.InferenceSession.SessionOptions = {
    graphOptimizationLevel: 'basic',
    enableCpuMemArena: false,
    enableMemPattern: false,
  };

  try {
    session = await createOrtSession(source, {
      ...baseOptions,
      executionProviders: preferWebGpu ? ['webgpu', 'wasm'] : ['wasm'],
    });
    loadedBackend = preferWebGpu ? 'webgpu' : 'wasm';
  } catch (error) {
    if (!preferWebGpu) throw error;
    session = await createOrtSession(source, {
      ...baseOptions,
      executionProviders: ['wasm'],
    });
    loadedBackend = 'wasm';
  }

  loadedModel = model;
}

async function loadModel(
  modelId: string,
  modelBuffers: readonly { buffer: ArrayBuffer }[],
  backendPreference: StemSeparationWorkerBackendPreference = 'auto',
): Promise<void> {
  const firstBuffer = modelBuffers[0]?.buffer;
  if (!firstBuffer) {
    throw new Error(`Stem separation model ${modelId} did not provide an ONNX file.`);
  }

  post({
    type: 'model-load-progress',
    modelId,
    phase: 'loading-model',
    progress: 0.2,
    message: 'Cached stem model reached worker. Opening runtime session.',
  });
  post({
    type: 'model-load-progress',
    modelId,
    phase: 'loading-model',
    progress: 0.9,
    message: 'Creating stem model runtime session.',
  });
  await loadModelFromSource(modelId, firstBuffer, backendPreference);
}

async function loadModelFromUrl(
  modelId: string,
  modelUrl: string,
  backendPreference: StemSeparationWorkerBackendPreference = 'auto',
): Promise<void> {
  if (!modelUrl) {
    throw new Error(`Stem separation model ${modelId} did not provide a URL.`);
  }

  const model = requireStemModel(modelId);
  const response = await fetch(modelUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download stem model: HTTP ${response.status}`);
  }

  const expectedBytes = Number(response.headers.get('content-length')) || model.files[0]?.sizeBytes || 0;
  let sessionSource: string | ArrayBuffer = modelUrl;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        downloadedBytes += value.byteLength;
        post({
          type: 'model-load-progress',
          modelId,
          phase: 'loading-model',
          progress: expectedBytes > 0 ? Math.min(0.85, downloadedBytes / expectedBytes) : 0.25,
          message: `Loading stem model in worker ${formatBytes(downloadedBytes)} / ${formatBytes(expectedBytes)}`,
        });
      }
    } finally {
      reader.releaseLock();
    }

    sessionSource = concatChunksToArrayBuffer(chunks, downloadedBytes);
    post({
      type: 'model-load-progress',
      modelId,
      phase: 'loading-model',
      progress: 0.88,
      message: `Stem model downloaded ${formatBytes(downloadedBytes)}. Opening runtime session.`,
    });
  } else {
    sessionSource = await response.arrayBuffer();
    post({
      type: 'model-load-progress',
      modelId,
      phase: 'loading-model',
      progress: 0.35,
      message: 'Stem model response is ready. Opening runtime session.',
    });
  }

  post({
    type: 'model-load-progress',
    modelId,
    phase: 'loading-model',
    progress: 0.9,
    message: 'Creating stem model runtime session.',
  });
  await loadModelFromSource(modelId, sessionSource, backendPreference);
}

async function separate(jobId: string, input: StemSeparationInput): Promise<StemSeparationWorkerStemResult[]> {
  if (!session || !loadedModel || loadedModel.id !== input.modelId) {
    throw new Error(`Stem separation model ${input.modelId} is not loaded.`);
  }

  const model = loadedModel;
  const stereo = normalizeToModelStereo(input, model);
  const totalSamples = stereo.left.length;
  const stride = Math.max(1, Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP)));
  const segmentStarts = createStemSegmentStarts(totalSamples, TRAINING_SAMPLES, stride);
  const totalSegments = segmentStarts.length;
  const outputs = model.outputStemOrder.map(() => ({
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
  }));
  const weights = new Float32Array(totalSamples);

  for (let segmentIndex = 0; segmentIndex < segmentStarts.length; segmentIndex += 1) {
    throwIfCancelled(jobId);
    const start = segmentStarts[segmentIndex] ?? 0;
    const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
    const segmentLength = end - start;
    const segmentLeft = new Float32Array(TRAINING_SAMPLES);
    const segmentRight = new Float32Array(TRAINING_SAMPLES);
    segmentLeft.set(stereo.left.subarray(start, end));
    segmentRight.set(stereo.right.subarray(start, end));

    post({
      type: 'progress',
      jobId,
      phase: 'separating',
      progress: segmentIndex / totalSegments,
      message: `Separating stem segment ${segmentIndex + 1} of ${totalSegments}`,
    });

    const prepared = prepareModelInput(segmentLeft, segmentRight);
    const waveformTensor = new ort.Tensor('float32', prepared.waveform, [1, 2, TRAINING_SAMPLES]);
    const magSpecTensor = new ort.Tensor('float32', prepared.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);
    const feeds: Record<string, ort.Tensor> = {
      [session.inputNames[0] ?? 'waveform']: waveformTensor,
    };
    if (session.inputNames.length > 1) {
      feeds[session.inputNames[1] ?? 'spec'] = magSpecTensor;
    }

    const inference = await session.run(feeds);
    throwIfCancelled(jobId);

    const { timeData, timeShape, freqData } = findDemucsOutputs(inference);
    const numTracks = Math.min(timeShape[1] ?? outputs.length, outputs.length);
    const numChannels = timeShape[2] ?? 2;
    const samples = timeShape[3] ?? TRAINING_SAMPLES;
    const frequencyOutputs = freqData ? frequencyOutputToSpecs(freqData) : null;
    const previousStart = segmentStarts[segmentIndex - 1];
    const nextStart = segmentStarts[segmentIndex + 1];
    const previousOverlap = previousStart === undefined ? 0 : Math.max(0, previousStart + TRAINING_SAMPLES - start);
    const nextOverlap = nextStart === undefined ? 0 : Math.max(0, start + TRAINING_SAMPLES - nextStart);
    const overlapWindow = createStemOverlapWindow(segmentLength, previousOverlap, nextOverlap);

    for (let trackIndex = 0; trackIndex < numTracks; trackIndex += 1) {
      const track = outputs[trackIndex];
      if (!track) continue;

      for (let index = 0; index < segmentLength && start + index < totalSamples; index += 1) {
        const frequencyTrack = frequencyOutputs?.[trackIndex];
        const timeBase = trackIndex * numChannels * samples;
        const leftValue = frequencyTrack
          ? (timeData[timeBase + index] ?? 0) + (frequencyTrack.left[index] ?? 0)
          : timeData[timeBase + index] ?? 0;
        const rightValue = frequencyTrack
          ? (timeData[timeBase + samples + index] ?? 0) + (frequencyTrack.right[index] ?? 0)
          : timeData[timeBase + samples + index] ?? 0;
        const weight = overlapWindow[index] ?? 0;
        track.left[start + index] += leftValue * weight;
        track.right[start + index] += rightValue * weight;
      }
    }

    for (let index = 0; index < segmentLength && start + index < totalSamples; index += 1) {
      weights[start + index] += overlapWindow[index] ?? 0;
    }

    post({
      type: 'progress',
      jobId,
      phase: 'separating',
      progress: (segmentIndex + 1) / totalSegments,
      message: `Separated stem segment ${segmentIndex + 1} of ${totalSegments}`,
    });
  }

  for (const track of outputs) {
    for (let index = 0; index < totalSamples; index += 1) {
      const weight = weights[index] ?? 0;
      if (weight > 0) {
        track.left[index] /= weight;
        track.right[index] /= weight;
      }
    }
  }

  return outputs.map((track, index) => ({
    kind: model.outputStemOrder[index] ?? model.stems[index] ?? 'other',
    sampleRate: model.inputSampleRate,
    channels: [track.left, track.right],
  }));
}

self.onmessage = async (event: MessageEvent<StemSeparationWorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'load-model':
        await loadModel(message.modelId, message.modelBuffers, message.backendPreference);
        post({
          type: 'model-ready',
          modelId: message.modelId,
          backend: loadedBackend ?? 'wasm',
        });
        break;

      case 'load-model-url':
        await loadModelFromUrl(message.modelId, message.modelUrl, message.backendPreference);
        post({
          type: 'model-ready',
          modelId: message.modelId,
          backend: loadedBackend ?? 'wasm',
        });
        break;

      case 'separate': {
        cancelledJobs.delete(message.jobId);
        const stems = await separate(message.jobId, message.input);
        const transfer = stems.flatMap(stem => stem.channels.map(channel => channel.buffer));
        post({ type: 'result', jobId: message.jobId, stems }, transfer);
        break;
      }

      case 'cancel':
        cancelledJobs.add(message.jobId);
        post({ type: 'cancelled', jobId: message.jobId });
        break;

      case 'dispose-model':
        session = null;
        loadedModel = null;
        loadedBackend = null;
        cancelledJobs.clear();
        break;

      default:
        post({ type: 'error', error: `Unknown stem worker message: ${(message as { type?: unknown }).type}` });
        break;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && 'jobId' in message) {
      post({ type: 'cancelled', jobId: message.jobId });
      return;
    }

    post({
      type: 'error',
      jobId: 'jobId' in message ? message.jobId : undefined,
      error: getErrorMessage(error),
    });
  }
};
