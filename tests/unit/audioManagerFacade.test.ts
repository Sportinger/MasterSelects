import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioManager } from '../../src/services/audioManager';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';

class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioParam {
  value = 0;
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();

  constructor() {
    super();
    this.gain.value = 1;
  }
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

let audioContextConstructCount = 0;

class MockAudioContext {
  sampleRate = 48000;
  state: AudioContextState = 'suspended';
  currentTime = 12.345;
  baseLatency = 0.012;
  outputLatency = 0.024;
  destination = Object.assign(new MockAudioNode(), { maxChannelCount: 2 });
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });

  constructor() {
    audioContextConstructCount++;
  }

  createGain(): GainNode {
    return new MockGainNode() as unknown as GainNode;
  }

  createAnalyser(): AnalyserNode {
    return new MockAnalyserNode() as unknown as AnalyserNode;
  }

  createChannelSplitter(): ChannelSplitterNode {
    return new MockAudioNode() as unknown as ChannelSplitterNode;
  }

  createBiquadFilter(): BiquadFilterNode {
    return new MockBiquadFilterNode() as unknown as BiquadFilterNode;
  }
}

function installAudioContextMock(): void {
  audioContextConstructCount = 0;
  const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
  globalScope.AudioContext = MockAudioContext as unknown as typeof AudioContext;
}

describe('audioManager facade', () => {
  const originalAudioContext = globalThis.AudioContext;

  afterEach(() => {
    vi.restoreAllMocks();
    audioRoutingManager.dispose();
    const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
    if (originalAudioContext) {
      globalScope.AudioContext = originalAudioContext;
    } else {
      Reflect.deleteProperty(globalScope, 'AudioContext');
    }
  });

  it('delegates resume to the audio routing manager', async () => {
    const resumeSpy = vi.spyOn(audioRoutingManager, 'resumeContext').mockResolvedValue(undefined);

    await audioManager.resume();

    expect(resumeSpy).toHaveBeenCalledTimes(1);
  });

  it('builds diagnostics from the routing manager snapshot', () => {
    const routingSnapshot = {
      context: {
        state: 'running',
        sampleRate: 48000,
        currentTime: 1.25,
        baseLatencyMs: 12,
        outputLatencyMs: 24,
        destinationMaxChannelCount: 2,
        resumePending: false,
      },
      routeCount: 2,
      masterRoute: {
        gain: 0.75,
        eqGains: [0, -2, 1],
      },
      routes: [],
      counters: {},
    };
    const snapshotSpy = vi
      .spyOn(audioRoutingManager, 'getDebugSnapshot')
      .mockReturnValue(routingSnapshot);

    const snapshot = audioManager.getDebugSnapshot();

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      deprecated: true,
      owner: 'audioRoutingManager',
      initialized: true,
      mediaElementSourceCount: 2,
      masterVolume: 0.75,
      context: routingSnapshot.context,
      routing: routingSnapshot,
    });
    expect(snapshot.eqGains).toEqual([0, -2, 1]);
  });

  it('does not create a second AudioContext when routing already owns one', async () => {
    installAudioContextMock();

    const context = audioRoutingManager.ensureSharedContext();
    expect(audioContextConstructCount).toBe(1);

    await audioManager.init();
    await audioManager.resume();

    expect(audioContextConstructCount).toBe(1);
    expect(audioManager.getContext()).toBe(context);
    expect((context as unknown as MockAudioContext).resume).toHaveBeenCalledTimes(1);
  });
});
