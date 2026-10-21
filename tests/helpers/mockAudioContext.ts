import { vi } from 'vitest';

/** A minimal Web Audio graph for routing tests: every node records connect/disconnect. */
class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();

  constructor() {
    super();
    this.gain.value = 1;
  }
}

class MockStereoPannerNode extends MockAudioNode {
  pan = new MockAudioParam();
}

class MockBiquadFilterNode extends MockAudioNode {
  type: BiquadFilterType = 'peaking';
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  gain = new MockAudioParam();
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 1024;
  frequencyBinCount = 512;
  smoothingTimeConstant = 0;
  getFloatTimeDomainData = vi.fn();
  getFloatFrequencyData = vi.fn();
}

class MockConvolverNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
}

class MockDelayNode extends MockAudioNode {
  delayTime = new MockAudioParam();
}

class MockDynamicsCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam();
  ratio = new MockAudioParam();
  knee = new MockAudioParam();
  attack = new MockAudioParam();
  release = new MockAudioParam();
  reduction = 0;
}

class MockWaveShaperNode extends MockAudioNode {
  curve: Float32Array | null = null;
}

class MockScriptProcessorNode extends MockAudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
}

export class MockAudioContext {
  sampleRate = 100;
  state: AudioContextState = 'running';
  currentTime = 0;
  baseLatency = 0;
  outputLatency = 0;
  destination = Object.assign(new MockAudioNode(), { maxChannelCount: 2 });

  createGain = vi.fn(() => new MockGainNode());
  createStereoPanner = vi.fn(() => new MockStereoPannerNode());
  createAnalyser = vi.fn(() => new MockAnalyserNode());
  createChannelSplitter = vi.fn(() => new MockAudioNode());
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode());
  createConvolver = vi.fn(() => new MockConvolverNode());
  createDelay = vi.fn(() => new MockDelayNode());
  createDynamicsCompressor = vi.fn(() => new MockDynamicsCompressorNode());
  createWaveShaper = vi.fn(() => new MockWaveShaperNode());
  createScriptProcessor = vi.fn(() => new MockScriptProcessorNode());
  private readonly sourcedElements = new WeakSet<object>();
  /** Like a browser: an element feeds one source node only, a second one throws. */
  createMediaElementSource = vi.fn((element: object) => {
    if (this.sourcedElements.has(element)) throw new DOMException('already connected', 'InvalidStateError');
    this.sourcedElements.add(element);
    return Object.assign(new MockAudioNode(), { context: this });
  });
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => {
    this.state = 'closed';
  });

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return {
      numberOfChannels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: vi.fn((channel: number) => channels[channel] ?? channels[0]),
    } as unknown as AudioBuffer;
  }
}

export function installAudioContextMock(): void {
  const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
  globalScope.AudioContext = MockAudioContext as unknown as typeof AudioContext;
}

