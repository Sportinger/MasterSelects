import { calculateAudioMeterSnapshot } from '../../audio/audioMetering';
import {
  createAudioInputConstraints,
  disconnectAudioNode,
  getAudioContextConstructor,
} from '../../audio/recording/captureShared';

export interface CaptureAudioLevels {
  display: number;
  microphone: number;
}

export interface CaptureAudioMix {
  recordingStream: MediaStream;
  hasDisplayAudio: boolean;
  hasMicrophoneAudio: boolean;
  getLevels(): CaptureAudioLevels;
  close(): Promise<void>;
}

export interface CaptureAudioMixOptions {
  displayStream: MediaStream;
  includeDisplayAudio: boolean;
  includeMicrophone: boolean;
  microphoneDeviceId?: string;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  createMediaStream?: (tracks: MediaStreamTrack[]) => MediaStream;
}

interface MeterRoute {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
}

export interface CapturePcmChunk {
  data: Float32Array<ArrayBuffer>;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  sourceTimestampUs: number;
  observedAtUs: number;
}

interface ActiveCaptureMix {
  context: AudioContext;
  bus: GainNode;
  numberOfChannels: number;
  tapCleanups: Set<() => Promise<void>>;
}

const activeMixes = new WeakMap<MediaStream, ActiveCaptureMix>();
const installedTapContexts = new WeakSet<AudioContext>();
const CAPTURE_TAP_PROCESSOR = `
class MasterSelectsCaptureTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopping = false;
    this.port.onmessage = event => {
      if (event.data?.type === 'stop') {
        this.stopping = true;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  process(inputs, outputs) {
    if (this.stopping) return false;
    const input = inputs[0];
    const output = outputs[0];
    if (input && input.length && input[0].length) {
      const channels = input.map(channel => new Float32Array(channel));
      this.port.postMessage({ channels, contextTime: currentTime, sampleRate }, channels.map(channel => channel.buffer));
      for (let channel = 0; channel < output.length; channel++) output[channel].set(input[channel] || input[0]);
    }
    return true;
  }
}
registerProcessor('masterselects-capture-tap', MasterSelectsCaptureTap);
`;

function createRoute(context: AudioContext, stream: MediaStream, destination: AudioNode): MeterRoute {
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(gain);
  gain.connect(analyser);
  analyser.connect(destination);
  return { source, gain, analyser, samples: new Float32Array(analyser.fftSize) };
}

function readLevel(route: MeterRoute | undefined): number {
  if (!route) return 0;
  route.analyser.getFloatTimeDomainData(route.samples);
  return calculateAudioMeterSnapshot(route.samples, Date.now()).rmsLinear;
}

export async function createCaptureAudioMix(options: CaptureAudioMixOptions): Promise<CaptureAudioMix> {
  const createMediaStream = options.createMediaStream ?? (tracks => new MediaStream(tracks));
  const displayAudioTrack = options.includeDisplayAudio ? options.displayStream.getAudioTracks()[0] : undefined;
  if (!displayAudioTrack && !options.includeMicrophone) {
    return {
      recordingStream: createMediaStream(options.displayStream.getVideoTracks()),
      hasDisplayAudio: false,
      hasMicrophoneAudio: false,
      getLevels: () => ({ display: 0, microphone: 0 }),
      close: async () => undefined,
    };
  }

  const AudioContextConstructor = getAudioContextConstructor();
  if (!options.createAudioContext && !AudioContextConstructor) {
    throw new Error('Audio mixing is not available in this browser.');
  }
  const context = options.createAudioContext?.() ?? new AudioContextConstructor!({ latencyHint: 'interactive' });
  let microphoneStream: MediaStream | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let bus: GainNode | undefined;
  let displayRoute: MeterRoute | undefined;
  let microphoneRoute: MeterRoute | undefined;
  try {
    if (context.state === 'suspended') await context.resume();
    if (options.includeMicrophone) {
      const getUserMedia = options.getUserMedia ?? (constraints => navigator.mediaDevices.getUserMedia(constraints));
      microphoneStream = await getUserMedia(createAudioInputConstraints(options.microphoneDeviceId));
    }
    destination = context.createMediaStreamDestination();
    bus = context.createGain();
    bus.channelCount = 2;
    bus.channelCountMode = 'explicit';
    bus.channelInterpretation = 'speakers';
    bus.connect(destination);
    displayRoute = displayAudioTrack
      ? createRoute(context, createMediaStream([displayAudioTrack]), bus)
      : undefined;
    microphoneRoute = microphoneStream?.getAudioTracks().length
      ? createRoute(context, microphoneStream, bus)
      : undefined;
    const recordingStream = createMediaStream([
      ...options.displayStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);
    const tapCleanups = new Set<() => Promise<void>>();
    activeMixes.set(recordingStream, { context, bus, numberOfChannels: 2, tapCleanups });
    return createCaptureAudioMixResult({
      context,
      destination,
      bus,
      displayRoute,
      microphoneRoute,
      microphoneStream,
      recordingStream,
      tapCleanups,
    });
  } catch (error) {
    [displayRoute?.source, displayRoute?.gain, displayRoute?.analyser, microphoneRoute?.source, microphoneRoute?.gain, microphoneRoute?.analyser, bus, destination]
      .forEach(node => disconnectAudioNode(node));
    microphoneStream?.getTracks().forEach(track => track.stop());
    destination?.stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => undefined);
    throw error;
  }
}

function createCaptureAudioMixResult(input: {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  bus: GainNode;
  displayRoute?: MeterRoute;
  microphoneRoute?: MeterRoute;
  microphoneStream?: MediaStream;
  recordingStream: MediaStream;
  tapCleanups: Set<() => Promise<void>>;
}): CaptureAudioMix {
  const nodes = [
    input.displayRoute?.source,
    input.displayRoute?.gain,
    input.displayRoute?.analyser,
    input.microphoneRoute?.source,
    input.microphoneRoute?.gain,
    input.microphoneRoute?.analyser,
    input.bus,
    input.destination,
  ];
  let closed = false;

  return {
    recordingStream: input.recordingStream,
    hasDisplayAudio: Boolean(input.displayRoute),
    hasMicrophoneAudio: Boolean(input.microphoneRoute),
    getLevels: () => closed
      ? { display: 0, microphone: 0 }
      : { display: readLevel(input.displayRoute), microphone: readLevel(input.microphoneRoute) },
    close: async () => {
      if (closed) return;
      closed = true;
      activeMixes.delete(input.recordingStream);
      await Promise.allSettled([...input.tapCleanups].map(cleanup => cleanup()));
      nodes.forEach(node => disconnectAudioNode(node));
      input.microphoneStream?.getTracks().forEach(track => track.stop());
      input.destination.stream.getTracks().forEach(track => track.stop());
      await input.context.close();
    },
  };
}

export function getCaptureAudioFormat(stream: MediaStream): { sampleRate: number; numberOfChannels: number } | null {
  const mix = activeMixes.get(stream);
  return mix ? { sampleRate: mix.context.sampleRate, numberOfChannels: mix.numberOfChannels } : null;
}

export async function createCaptureAudioTap(
  stream: MediaStream,
  onPcm: (chunk: CapturePcmChunk) => void,
  onError?: (error: Error) => void,
): Promise<(() => Promise<void>) | null> {
  const mix = activeMixes.get(stream);
  if (!mix) return null;
  if (!installedTapContexts.has(mix.context)) {
    const url = URL.createObjectURL(new Blob([CAPTURE_TAP_PROCESSOR], { type: 'text/javascript' }));
    try {
      await mix.context.audioWorklet.addModule(url);
      installedTapContexts.add(mix.context);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const node = new AudioWorkletNode(mix.context, 'masterselects-capture-tap', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: mix.numberOfChannels,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    outputChannelCount: [mix.numberOfChannels],
  });
  const destination = mix.context.createMediaStreamDestination();
  const performanceOffsetSeconds = performance.now() / 1000 - mix.context.currentTime;
  let acknowledgeStop: (() => void) | null = null;
  node.port.onmessage = (event: MessageEvent<{ type?: string; channels?: Float32Array[]; contextTime?: number; sampleRate?: number }>) => {
    if (event.data.type === 'stopped') {
      acknowledgeStop?.();
      return;
    }
    const channels = event.data.channels;
    if (!channels || event.data.contextTime === undefined || event.data.sampleRate === undefined) return;
    const numberOfFrames = channels[0]?.length ?? 0;
    if (numberOfFrames === 0 || channels.length === 0) return;
    const data = new Float32Array(numberOfFrames * channels.length);
    channels.forEach((channel, index) => data.set(channel, index * numberOfFrames));
    onPcm({
      data,
      sampleRate: event.data.sampleRate,
      numberOfFrames,
      numberOfChannels: channels.length,
      sourceTimestampUs: Math.round((performanceOffsetSeconds + event.data.contextTime) * 1_000_000),
      observedAtUs: performance.now() * 1000,
    });
  };
  node.addEventListener('processorerror', () => {
    acknowledgeStop?.();
    onError?.(new Error('The screen capture audio worklet stopped unexpectedly.'));
  });
  mix.bus.connect(node);
  node.connect(destination);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    mix.tapCleanups.delete(close);
    await Promise.race([
      new Promise<void>(resolve => {
        acknowledgeStop = resolve;
        node.port.postMessage({ type: 'stop' });
      }),
      new Promise<void>(resolve => globalThis.setTimeout(resolve, 1000)),
    ]);
    try { mix.bus.disconnect(node); } catch { /* already disconnected */ }
    disconnectAudioNode(node);
    node.port.close();
    destination.stream.getTracks().forEach(track => track.stop());
    disconnectAudioNode(destination);
  };
  mix.tapCleanups.add(close);
  return close;
}
