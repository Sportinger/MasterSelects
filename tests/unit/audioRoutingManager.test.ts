import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import type { LiveAudioRouteProcessor } from '../../src/services/audio/audioGraphRouteSettings';

class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
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

class MockAudioContext {
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
  createMediaElementSource = vi.fn(() => new MockAudioNode());
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

function installAudioContextMock(): void {
  const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
  globalScope.AudioContext = MockAudioContext as unknown as typeof AudioContext;
}

function getCounters(): Record<string, number> {
  return audioRoutingManager.getDebugSnapshot().counters as Record<string, number>;
}

function createReverbProcessor(decaySeconds: number): Extract<LiveAudioRouteProcessor, { type: 'reverb' }> {
  return {
    id: `reverb-${decaySeconds}`,
    type: 'reverb',
    roomSize: 0.5,
    decaySeconds,
    damping: 0.25,
    mix: 1,
  };
}

function cacheReverbImpulse(routeKey: string, decaySeconds: number): void {
  const context = audioRoutingManager.ensureSharedContext();
  const sourceNode = context.createGain();
  audioRoutingManager.applyNodeEffects(routeKey, sourceNode, 1, [], 0, [createReverbProcessor(decaySeconds)]);
}

describe('audioRoutingManager reverb impulse cache lifecycle', () => {
  const originalAudioContext = globalThis.AudioContext;

  beforeEach(() => {
    audioRoutingManager.dispose();
    installAudioContextMock();
  });

  afterEach(() => {
    audioRoutingManager.dispose();
    const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
    if (originalAudioContext) {
      globalScope.AudioContext = originalAudioContext;
    } else {
      delete globalScope.AudioContext;
    }
    vi.restoreAllMocks();
  });

  it('clears and reports the reverb impulse cache through the explicit debug path', () => {
    const before = getCounters();

    cacheReverbImpulse('manual-clear-route', 0.1);
    expect(getCounters().reverbImpulseCacheSize).toBe(1);
    expect(getCounters().reverbImpulseCacheLimit).toBe(24);

    expect(audioRoutingManager.clearReverbImpulseCache()).toBe(1);

    const after = getCounters();
    expect(after.reverbImpulseCacheSize).toBe(0);
    expect(after.reverbImpulseCacheClears).toBe((before.reverbImpulseCacheClears ?? 0) + 1);
    expect(after.reverbImpulseCacheClearedEntries).toBe((before.reverbImpulseCacheClearedEntries ?? 0) + 1);
  });

  it('clears and reports retained reverb impulses during lifecycle disposal', () => {
    const before = getCounters();

    cacheReverbImpulse('dispose-route', 0.2);
    expect(getCounters().reverbImpulseCacheSize).toBe(1);

    audioRoutingManager.dispose();

    const after = getCounters();
    expect(audioRoutingManager.getDebugSnapshot().context).toBeNull();
    expect(after.reverbImpulseCacheSize).toBe(0);
    expect(after.reverbImpulseCacheClears).toBe((before.reverbImpulseCacheClears ?? 0) + 1);
    expect(after.reverbImpulseCacheClearedEntries).toBe((before.reverbImpulseCacheClearedEntries ?? 0) + 1);
  });
});
