import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import type { LiveAudioRouteProcessor } from '../../src/services/audio/audioGraphRouteSettings';
import { installAudioContextMock } from '../helpers/mockAudioContext';

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

describe('audioRoutingManager media routes', () => {
  const originalAudioContext = globalThis.AudioContext;
  const element = () => document.createElement('audio');
  const createdSources = () => (audioRoutingManager.getActiveContext() as unknown as {
    createMediaElementSource: ReturnType<typeof vi.fn>;
  }).createMediaElementSource.mock.calls.length;

  beforeEach(() => {
    audioRoutingManager.dispose();
    installAudioContextMock();
  });

  afterEach(() => {
    audioRoutingManager.dispose();
    const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
    if (originalAudioContext) globalScope.AudioContext = originalAudioContext;
    else delete globalScope.AudioContext;
  });

  it('builds one route for requests that arrive while it is still being created', async () => {
    const audio = element();
    const results = await Promise.all([
      audioRoutingManager.applyEffects(audio, 1, []),
      audioRoutingManager.applyEffects(audio, 1, []),
    ]);
    expect(results).toEqual([true, true]);
    expect(audioRoutingManager.activeRouteCount).toBe(1);
    expect(createdSources()).toBe(1);
  });

  it('cancels a route that is removed or disposed before it is built', async () => {
    const disposed = element();
    const pending = audioRoutingManager.applyEffects(disposed, 1, []);
    audioRoutingManager.disposeRoute(disposed);
    expect(await pending).toBe(false);
    const removed = element();
    const removedPending = audioRoutingManager.applyEffects(removed, 1, []);
    audioRoutingManager.removeRoute(removed);
    expect(await removedPending).toBe(false);
    // No connected graph is left behind for elements nobody owns any more.
    expect(audioRoutingManager.activeRouteCount).toBe(0);
    expect(audioRoutingManager.hasRoute(disposed)).toBe(false);
    // A later request builds the route normally.
    expect(await audioRoutingManager.applyEffects(removed, 1, [])).toBe(true);
    expect(audioRoutingManager.activeRouteCount).toBe(1);
  });

  it('reuses the source node when a disposed element is routed again', async () => {
    type Node = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
    const routeOf = (media: HTMLMediaElement) =>
      (audioRoutingManager as unknown as { routes: Map<HTMLMediaElement, { cutGainNode: Node }> }).routes.get(media);
    const audio = element();
    expect(await audioRoutingManager.applyEffects(audio, 1, [])).toBe(true);
    const source = (audioRoutingManager.getActiveContext() as unknown as {
      createMediaElementSource: { mock: { results: Array<{ value: Node }> } };
    }).createMediaElementSource.mock.results[0].value;
    const firstCutGain = routeOf(audio)!.cutGainNode;
    source.disconnect.mockClear();
    audioRoutingManager.disposeRoute(audio);
    expect(audioRoutingManager.activeRouteCount).toBe(0);
    // The disposed graph no longer hears the element.
    expect(source.disconnect).toHaveBeenCalled();
    source.connect.mockClear();
    // A browser refuses a second source node for one element; the route still comes back.
    expect(await audioRoutingManager.applyEffects(audio, 1, [])).toBe(true);
    expect(audioRoutingManager.hasRoute(audio)).toBe(true);
    expect(createdSources()).toBe(1);
    const nextCutGain = routeOf(audio)!.cutGainNode;
    expect(nextCutGain).not.toBe(firstCutGain);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledWith(nextCutGain);
  });
});
