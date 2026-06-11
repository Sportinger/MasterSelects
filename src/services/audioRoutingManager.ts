/**
 * AudioRoutingManager - Routes audio through Web Audio API for live EQ and volume
 *
 * Architecture:
 * HTMLMediaElement -> track Gain/EQ/FX -> track meter -> shared master bus -> Destination
 *
 * Efficiency:
 * - Single shared AudioContext
 * - Lazy connection (only when playing)
 * - Node caching per element (MediaElementSourceNode can only be created once)
 * - Delta updates for filter gains
 */

import { Logger } from './logger';
import type { AudioRouteEffectSettings, LiveAudioRouteProcessor } from './audio/audioGraphRouteSettings';
import { buildAudioRoutingDebugSnapshot } from './audio/routing/debugSnapshots';
import { readRouteMeterSnapshot, type ReadRouteMeterSnapshotOptions } from './audio/routing/meteringSnapshots';
import { reconnectCustomProcessorInternal } from './audio/routing/processorGraphReconnect';
import { createProcessorNode } from './audio/routing/processorNodeFactory';
import { updateProcessorNode } from './audio/routing/processorNodeUpdate';
import {
  applyMasterRouteEffectState,
  applyTrackRouteEffectState,
  isMasterRouteEffectStateApplied,
  isTrackRouteEffectStateApplied,
  processorSignature,
} from './audio/routing/routeEffectState';
import { createAudioRouteGraph, createMasterRouteGraph } from './audio/routing/routeGraphFactory';
import type {
  AudioRoute,
  AudioRoutingDebugCounters,
  MasterAudioRoute,
  ProcessorNodeUpdateDeps,
} from './audio/routing/routeGraphTypes';
import {
  clearReverbImpulseCache as clearReverbImpulseCacheEntries,
  getOrCreateReverbImpulse,
  REVERB_IMPULSE_CACHE_LIMIT,
} from './audio/routing/reverbImpulseCache';
import type { AudioMeterSnapshot } from '../types/audio';

const log = Logger.create('AudioRouting');

const ROUTE_CREATE_RETRY_COOLDOWN_MS = 5000;
const ROUTE_CREATE_WARNING_INTERVAL_MS = 15000;

const audioRoutingDebugCounters: AudioRoutingDebugCounters = {
  applyEffectsCalls: 0,
  routeCreates: 0,
  routeProcessorRebuilds: 0,
  masterProcessorRebuilds: 0,
  reverbImpulseBuilds: 0,
  reverbImpulseCacheHits: 0,
  reverbImpulseCacheEvictions: 0,
  reverbImpulseCacheClears: 0,
  reverbImpulseCacheClearedEntries: 0,
  reverbImpulseBuildMsTotal: 0,
  reverbImpulseBuildMsMax: 0,
};

const reverbImpulseCache = new Map<string, AudioBuffer>();

class AudioRoutingManager {
  private audioContext: AudioContext | null = null;
  private masterRoute: MasterAudioRoute | null = null;
  private routes = new Map<HTMLMediaElement, AudioRoute>();
  // Routes whose source is an arbitrary AudioNode (e.g. the per-track MIDI synth
  // bus), keyed by a stable string id (the track id). They reuse the exact same
  // gain/FX/EQ/pan/meter chain as media routes and feed the shared master bus.
  private nodeRoutes = new Map<string, AudioRoute>();
  private routeCreateFailures = new WeakMap<HTMLMediaElement, { retryAt: number; lastLoggedAt: number }>();
  private contextResumePromise: Promise<void> | null = null;
  private masterMeterMemo: { at: number; snapshot: AudioMeterSnapshot } | null = null;
  private readonly processorNodeDeps: ProcessorNodeUpdateDeps = {
    getOrCreateReverbImpulse: (ctx, roomSize, decaySeconds, damping) => getOrCreateReverbImpulse(
      reverbImpulseCache,
      audioRoutingDebugCounters,
      ctx,
      roomSize,
      decaySeconds,
      damping,
    ),
  };

  /**
   * Get or create the shared AudioContext
   */
  private async getContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.masterRoute = null;
      log.info('Created new AudioContext');
    }

    // Resume if suspended (autoplay policy)
    if (this.audioContext.state === 'suspended') {
      if (!this.contextResumePromise) {
        this.contextResumePromise = this.audioContext.resume().then(() => {
          this.contextResumePromise = null;
        });
      }
      await this.contextResumePromise;
    }

    return this.audioContext;
  }

  private getOrCreateMasterRoute(ctx: AudioContext): MasterAudioRoute {
    if (this.masterRoute) return this.masterRoute;

    this.masterRoute = createMasterRouteGraph(ctx);
    this.reconnectMasterRouteChain(this.masterRoute);
    return this.masterRoute;
  }

  /**
   * Get or create audio route for an element
   */
  private async getOrCreateRoute(element: HTMLMediaElement): Promise<AudioRoute | null> {
    // Check if route already exists
    let route = this.routes.get(element);
    if (route) {
      if (!route.isConnected) {
        this.reconnectRouteChain(route);
      }
      return route;
    }

    const previousFailure = this.routeCreateFailures.get(element);
    const now = performance.now();
    if (previousFailure && now < previousFailure.retryAt) {
      return null;
    }

    try {
      const ctx = await this.getContext();
      this.getOrCreateMasterRoute(ctx);

      // Create source node (can only be done ONCE per element)
      const sourceNode = ctx.createMediaElementSource(element);

      // Connect chain: source -> track gain/FX/EQ/pan -> track meter -> master bus
      route = createAudioRouteGraph(ctx, sourceNode);
      this.reconnectRouteChain(route);

      this.routes.set(element, route);
      this.routeCreateFailures.delete(element);
      audioRoutingDebugCounters.routeCreates++;
      log.debug('Created audio route for element');

      return route;
    } catch (err) {
      // MediaElementSourceNode can fail if element is already connected elsewhere
      // or if there's a CORS issue with the audio source
      const failure = this.routeCreateFailures.get(element);
      if (!failure || now - failure.lastLoggedAt > ROUTE_CREATE_WARNING_INTERVAL_MS) {
        log.warn('Failed to create audio route:', err);
      }
      this.routeCreateFailures.set(element, {
        retryAt: now + ROUTE_CREATE_RETRY_COOLDOWN_MS,
        lastLoggedAt: failure?.lastLoggedAt && now - failure.lastLoggedAt <= ROUTE_CREATE_WARNING_INTERVAL_MS
          ? failure.lastLoggedAt
          : now,
      });
      return null;
    }
  }

  /**
   * Apply volume and EQ to an audio element
   * Call this every frame for elements that are playing
   */
  async applyEffects(
    element: HTMLMediaElement,
    volume: number,
    eqGains: readonly number[], // Array of 10 gain values in dB (-12 to +12)
    pan = 0,
    processors: readonly LiveAudioRouteProcessor[] = [],
    masterRoute?: AudioRouteEffectSettings,
  ): Promise<boolean> {
    audioRoutingDebugCounters.applyEffectsCalls++;
    const route = await this.getOrCreateRoute(element);
    if (!route) {
      // Fallback: just set element volume directly (no EQ)
      element.volume = Math.max(0, Math.min(1, volume * (masterRoute?.volume ?? 1)));
      return false;
    }

    const ctx = this.audioContext;
    if (!ctx) return false;
    this.updateMasterRoute(ctx, masterRoute);
    this.updateRouteProcessors(route, ctx, processors);
    applyTrackRouteEffectState(route, volume, eqGains, pan);

    // When using Web Audio routing, the element volume should be 1
    // (volume is controlled by the GainNode)
    if (element.volume !== 1) {
      element.volume = 1;
    }

    return true;
  }

  /**
   * Ensure the shared AudioContext + master bus exist and return the context.
   * Synchronous (creates the context if needed and kicks a background resume) so
   * generated sources like the MIDI synth can build nodes in the same context and
   * route into the same master bus that media tracks use. Mirrors getContext()
   * without awaiting the resume.
   */
  ensureSharedContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.masterRoute = null;
      log.info('Created new AudioContext (shared)');
    }
    if (this.audioContext.state === 'suspended' && !this.contextResumePromise) {
      this.contextResumePromise = this.audioContext
        .resume()
        .then(() => {
          this.contextResumePromise = null;
        })
        .catch(() => {
          this.contextResumePromise = null;
        });
    }
    this.getOrCreateMasterRoute(this.audioContext);
    return this.audioContext;
  }

  /** The active shared AudioContext, or null before one is created. */
  getActiveContext(): AudioContext | null {
    return this.audioContext;
  }

  async resumeContext(): Promise<void> {
    await this.getContext();
  }

  /**
   * Apply volume/EQ/pan/FX/master to an arbitrary node source (e.g. the MIDI
   * synth bus), keyed by a stable id. Builds/maintains a full per-track chain
   * identical to a media route and feeds the shared master bus. Returns false if
   * no context exists yet (call ensureSharedContext() first).
   */
  applyNodeEffects(
    key: string,
    sourceNode: AudioNode,
    volume: number,
    eqGains: readonly number[],
    pan = 0,
    processors: readonly LiveAudioRouteProcessor[] = [],
    masterRoute?: AudioRouteEffectSettings,
  ): boolean {
    const ctx = this.audioContext;
    if (!ctx) return false;
    const route = this.getOrCreateNodeRoute(key, sourceNode, ctx);
    this.updateMasterRoute(ctx, masterRoute);
    this.updateRouteProcessors(route, ctx, processors);
    applyTrackRouteEffectState(route, volume, eqGains, pan);

    return true;
  }

  getNodeMeterSnapshot(
    key: string,
    updatedAt = performance.now(),
    options?: ReadRouteMeterSnapshotOptions,
  ): AudioMeterSnapshot | null {
    const route = this.nodeRoutes.get(key);
    if (!route) return null;

    return readRouteMeterSnapshot(route, updatedAt, options);
  }

  /** Tear down a node route. Does not disconnect the source node (caller owns it). */
  removeNodeRoute(key: string): void {
    const route = this.nodeRoutes.get(key);
    if (!route) return;
    try {
      route.gainNode.disconnect();
      route.panNode.disconnect();
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Ignore disconnect errors
    }
    this.nodeRoutes.delete(key);
  }

  private getOrCreateNodeRoute(key: string, sourceNode: AudioNode, ctx: AudioContext): AudioRoute {
    const existing = this.nodeRoutes.get(key);
    if (existing) {
      // Re-wire if the source node was rebuilt (e.g. synth recreated).
      if (existing.sourceNode !== sourceNode) {
        try {
          existing.sourceNode.disconnect();
        } catch {
          // ignore
        }
        existing.sourceNode = sourceNode;
        this.reconnectRouteChain(existing);
      }
      return existing;
    }

    this.getOrCreateMasterRoute(ctx);
    const route = createAudioRouteGraph(ctx, sourceNode);
    this.reconnectRouteChain(route);
    this.nodeRoutes.set(key, route);
    return route;
  }

  /**
   * Check if an element has an active audio route
   */
  hasRoute(element: HTMLMediaElement): boolean {
    return this.routes.has(element);
  }

  /**
   * Sync check whether a routed element already has the requested effect state
   * fully applied, so per-frame callers can skip the async applyEffects() path
   * (and its promise churn) entirely. Conservative: any active processors —
   * track or master — return false, because processor parameter updates must
   * keep flowing through applyEffects() every frame.
   */
  isRouteEffectStateApplied(
    element: HTMLMediaElement,
    volume: number,
    eqGains: readonly number[],
    pan: number,
    processors: readonly LiveAudioRouteProcessor[] = [],
    masterRoute?: AudioRouteEffectSettings,
  ): boolean {
    const route = this.routes.get(element);
    if (!route || !route.isConnected) return false;
    // applyEffects() pins element volume to 1 while routed; a drifted element
    // volume means the invariant must be restored through the full path.
    if (element.volume !== 1) return false;
    if (processors.length > 0 || route.lastProcessorSignature !== '') return false;
    if (!isTrackRouteEffectStateApplied(route, volume, eqGains, pan)) return false;

    const master = this.masterRoute;
    if (!master) return false;
    if ((masterRoute?.processors?.length ?? 0) > 0 || master.lastProcessorSignature !== '') return false;
    return isMasterRouteEffectStateApplied(master, masterRoute?.volume ?? 1, masterRoute?.eqGains ?? []);
  }

  pauseAllRoutedMedia(): void {
    for (const element of this.routes.keys()) {
      element.pause();
    }
  }

  getMeterSnapshot(
    element: HTMLMediaElement,
    updatedAt = performance.now(),
    options?: ReadRouteMeterSnapshotOptions,
  ): AudioMeterSnapshot | null {
    const route = this.routes.get(element);
    if (!route) return null;

    return readRouteMeterSnapshot(route, updatedAt, options);
  }

  getMasterMeterSnapshot(
    updatedAt = performance.now(),
    options?: ReadRouteMeterSnapshotOptions,
  ): AudioMeterSnapshot | null {
    const route = this.masterRoute;
    if (!route) return null;

    // Every routed element publishes its meter alongside the master snapshot,
    // so without a memo the master analysers get re-read once per element per
    // tick. Sub-16ms granularity carries no information for meters.
    const memo = this.masterMeterMemo;
    if (
      memo
      && updatedAt - memo.at < 16
      && (!options?.includeSpectrum || memo.snapshot.spectrumDb !== undefined)
    ) {
      return memo.snapshot;
    }

    const snapshot = readRouteMeterSnapshot(route, updatedAt, options);
    this.masterMeterMemo = { at: updatedAt, snapshot };
    return snapshot;
  }

  /**
   * Disconnect and remove route for an element
   * Call when element is no longer needed
   */
  removeRoute(element: HTMLMediaElement): void {
    const route = this.routes.get(element);
    if (route) {
      try {
        route.sourceNode.disconnect();
        route.gainNode.disconnect();
        route.panNode.disconnect();
        route.analyserNode.disconnect();
        route.stereoSplitterNode.disconnect();
        route.leftAnalyserNode.disconnect();
        route.rightAnalyserNode.disconnect();
        route.eqFilters.forEach(f => f.disconnect());
        route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      } catch {
        // Ignore disconnect errors
      }
      route.isConnected = false;
      log.debug('Removed audio route');
    }
  }

  disposeRoute(element: HTMLMediaElement): void {
    this.removeRoute(element);
    this.routes.delete(element);
  }

  /**
   * Clean up all routes and close context
   */
  dispose(): void {
    for (const element of Array.from(this.routes.keys())) {
      this.disposeRoute(element);
    }
    for (const key of [...this.nodeRoutes.keys()]) {
      this.removeNodeRoute(key);
    }
    this.disconnectMasterRoute();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.masterRoute = null;
    const clearedReverbImpulses = this.clearReverbImpulseCache();
    log.info('AudioRoutingManager disposed', { clearedReverbImpulses });
  }

  clearReverbImpulseCache(): number {
    return clearReverbImpulseCacheEntries(reverbImpulseCache, audioRoutingDebugCounters);
  }

  /**
   * Get the number of active routes (for debugging)
   */
  get activeRouteCount(): number {
    return this.routes.size;
  }

  getDebugSnapshot(): Record<string, unknown> {
    const context = this.audioContext as (AudioContext & { outputLatency?: number }) | null;
    return buildAudioRoutingDebugSnapshot({
      context,
      masterRoute: this.masterRoute,
      routes: this.routes,
      counters: audioRoutingDebugCounters,
      reverbImpulseCacheLimit: REVERB_IMPULSE_CACHE_LIMIT,
      reverbImpulseCacheSize: reverbImpulseCache.size,
      resumePending: this.contextResumePromise !== null,
    });
  }

  private disconnectMasterRoute(): void {
    const route = this.masterRoute;
    if (!route) return;
    try {
      route.inputNode.disconnect();
      route.gainNode.disconnect();
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Ignore disconnect errors during teardown.
    }
  }

  private updateRouteProcessors(
    route: AudioRoute,
    ctx: BaseAudioContext,
    processors: readonly LiveAudioRouteProcessor[],
  ): void {
    const signature = processorSignature(processors);
    if (signature !== route.lastProcessorSignature) {
      audioRoutingDebugCounters.routeProcessorRebuilds++;
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      route.processorNodes = processors.map(processor => createProcessorNode(ctx, processor, this.processorNodeDeps));
      route.lastProcessorSignature = signature;
      this.reconnectRouteChain(route);
      return;
    }

    processors.forEach((processor, index) => {
      const node = route.processorNodes[index];
      if (node) updateProcessorNode(ctx, node, processor, this.processorNodeDeps);
    });
  }

  private updateMasterRoute(
    ctx: AudioContext,
    settings: AudioRouteEffectSettings | undefined,
  ): void {
    const route = this.getOrCreateMasterRoute(ctx);
    const volume = settings?.volume ?? 1;
    const eqGains = settings?.eqGains ?? [];
    const processors = settings?.processors ?? [];
    const masterRouteChanged =
      !isMasterRouteEffectStateApplied(route, volume, eqGains) ||
      processorSignature(processors) !== route.lastProcessorSignature;
    if (masterRouteChanged) {
      this.masterMeterMemo = null;
    }

    applyMasterRouteEffectState(route, volume, eqGains);

    const signature = processorSignature(processors);
    if (signature !== route.lastProcessorSignature) {
      audioRoutingDebugCounters.masterProcessorRebuilds++;
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
      route.processorNodes = processors.map(processor => createProcessorNode(ctx, processor, this.processorNodeDeps));
      route.lastProcessorSignature = signature;
      this.reconnectMasterRouteChain(route);
      return;
    }

    processors.forEach((processor, index) => {
      const node = route.processorNodes[index];
      if (node) updateProcessorNode(ctx, node, processor, this.processorNodeDeps);
    });
  }

  private reconnectRouteChain(route: AudioRoute): void {
    try {
      route.sourceNode.disconnect();
      route.gainNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.panNode.disconnect();
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Disconnecting a partially connected graph can throw; rebuild below.
    }

    let tail: AudioNode = route.gainNode;
    route.sourceNode.connect(route.gainNode);

    for (const processor of route.processorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectCustomProcessorInternal(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }

    tail.connect(route.eqFilters[0]);
    for (let i = 0; i < route.eqFilters.length - 1; i++) {
      route.eqFilters[i].connect(route.eqFilters[i + 1]);
    }
    route.eqFilters[route.eqFilters.length - 1].connect(route.panNode);
    route.panNode.connect(route.stereoSplitterNode);
    route.stereoSplitterNode.connect(route.leftAnalyserNode, 0);
    route.stereoSplitterNode.connect(route.rightAnalyserNode, 1);
    route.panNode.connect(route.analyserNode);
    route.analyserNode.connect(this.getOrCreateMasterRoute(this.audioContext!).inputNode);
    route.isConnected = true;
  }

  private reconnectMasterRouteChain(route: MasterAudioRoute): void {
    try {
      route.inputNode.disconnect();
      route.gainNode.disconnect();
      route.eqFilters.forEach(filter => filter.disconnect());
      route.analyserNode.disconnect();
      route.stereoSplitterNode.disconnect();
      route.leftAnalyserNode.disconnect();
      route.rightAnalyserNode.disconnect();
      route.processorNodes.forEach(processor => processor.nodes.forEach(node => node.disconnect()));
    } catch {
      // Disconnecting a partially connected graph can throw; rebuild below.
    }

    let tail: AudioNode = route.inputNode;

    for (const processor of route.processorNodes) {
      if (processor.inputNode && processor.outputNode) {
        reconnectCustomProcessorInternal(processor);
        tail.connect(processor.inputNode);
        tail = processor.outputNode;
      } else {
        for (const node of processor.nodes) {
          tail.connect(node);
          tail = node;
        }
      }
    }

    tail.connect(route.eqFilters[0]);
    for (let index = 0; index < route.eqFilters.length - 1; index += 1) {
      route.eqFilters[index].connect(route.eqFilters[index + 1]);
    }
    route.eqFilters[route.eqFilters.length - 1].connect(route.gainNode);
    route.gainNode.connect(route.stereoSplitterNode);
    route.stereoSplitterNode.connect(route.leftAnalyserNode, 0);
    route.stereoSplitterNode.connect(route.rightAnalyserNode, 1);
    route.gainNode.connect(route.analyserNode);
    route.analyserNode.connect(this.audioContext!.destination);
  }
}

// Singleton instance
export const audioRoutingManager = new AudioRoutingManager();
