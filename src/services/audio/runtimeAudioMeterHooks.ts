// React hooks for consuming the runtime audio meter bus.
//
// These hooks subscribe to the bus once per (scope, feature-set) and keep the latest
// snapshot in a ref so visual meters can animate through refs/CSS/canvas without forcing
// a React render per published snapshot. Use `useRuntimeAudioMeterSnapshot` only where
// React text/state must update; prefer the ref/frame APIs for live meter animation.

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { AudioMeterSnapshot } from '../../types';
import {
  runtimeAudioMeterBus,
  type RuntimeAudioMeterScope,
  type RuntimeAudioMeterSubscriptionOptions,
} from './runtimeAudioMeterBus';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getScopeSnapshot(scope: RuntimeAudioMeterScope | undefined): AudioMeterSnapshot | undefined {
  if (!scope) return undefined;
  return scope.kind === 'master'
    ? runtimeAudioMeterBus.getMasterSnapshot()
    : runtimeAudioMeterBus.getTrackSnapshot(scope.trackId);
}

function subscribeScope(
  scope: RuntimeAudioMeterScope,
  listener: (snapshot: AudioMeterSnapshot | undefined) => void,
  options: RuntimeAudioMeterSubscriptionOptions | undefined,
): () => void {
  return scope.kind === 'master'
    ? runtimeAudioMeterBus.subscribeMaster(listener, options)
    : runtimeAudioMeterBus.subscribeTrack(scope.trackId, listener, options);
}

function featuresKeyOf(options: RuntimeAudioMeterSubscriptionOptions | undefined): string {
  return options?.features ? [...options.features].join(',') : '';
}

function dynamicsKeyOf(options: RuntimeAudioMeterSubscriptionOptions | undefined): string {
  return options?.dynamicsEffectIds ? [...options.dynamicsEffectIds].join(',') : '';
}

type RuntimeAudioMeterFrameFlush = () => void;

const activeFramePollers = new Set<RuntimeAudioMeterFrameFlush>();
let framePollTimer: number | null = null;
let framePollRaf: number | null = null;
const RUNTIME_AUDIO_METER_VISUAL_INTERVAL_MS = 50;

function runRuntimeAudioMeterFramePollers(): void {
  framePollRaf = null;
  const flushes = Array.from(activeFramePollers);
  for (const flush of flushes) {
    flush();
  }
  scheduleRuntimeAudioMeterFramePoll();
}

function scheduleRuntimeAudioMeterFramePoll(): void {
  if (activeFramePollers.size === 0 || framePollTimer !== null || framePollRaf !== null) return;
  if (typeof window === 'undefined') return;
  framePollTimer = window.setTimeout(() => {
    framePollTimer = null;
    if (typeof window.requestAnimationFrame === 'function') {
      framePollRaf = window.requestAnimationFrame(runRuntimeAudioMeterFramePollers);
      return;
    }
    runRuntimeAudioMeterFramePollers();
  }, RUNTIME_AUDIO_METER_VISUAL_INTERVAL_MS);
}

function addRuntimeAudioMeterFramePoller(flush: RuntimeAudioMeterFrameFlush): void {
  activeFramePollers.add(flush);
  scheduleRuntimeAudioMeterFramePoll();
}

function removeRuntimeAudioMeterFramePoller(flush: RuntimeAudioMeterFrameFlush): void {
  activeFramePollers.delete(flush);
  if (activeFramePollers.size > 0) return;
  if (framePollTimer !== null) {
    window.clearTimeout(framePollTimer);
    framePollTimer = null;
  }
  if (framePollRaf !== null && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(framePollRaf);
    framePollRaf = null;
  }
}

/**
 * Keep the latest meter snapshot for `scope` in a ref. The caller drives its own
 * animation/read cadence. No React render is triggered when snapshots change.
 */
export function useRuntimeAudioMeterRef(
  scope: RuntimeAudioMeterScope | undefined,
  options?: RuntimeAudioMeterSubscriptionOptions,
): MutableRefObject<AudioMeterSnapshot | undefined> {
  const snapshotRef = useRef<AudioMeterSnapshot | undefined>(getScopeSnapshot(scope));
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const kind = scope?.kind;
  const trackId = scope && scope.kind === 'track' ? scope.trackId : undefined;
  const featuresKey = featuresKeyOf(options);
  const dynamicsKey = dynamicsKeyOf(options);

  useEffect(() => {
    if (!kind) {
      snapshotRef.current = undefined;
      return undefined;
    }
    const scopeArg: RuntimeAudioMeterScope = kind === 'master'
      ? { kind: 'master' }
      : { kind: 'track', trackId: trackId as string };
    snapshotRef.current = getScopeSnapshot(scopeArg);
    return subscribeScope(scopeArg, (snapshot) => {
      snapshotRef.current = snapshot;
    }, optionsRef.current);
    // optionsRef is intentionally not a dep; featuresKey/dynamicsKey capture its identity.
  }, [kind, trackId, featuresKey, dynamicsKey]);

  return snapshotRef;
}

/**
 * Subscribe to `scope` and invoke `onFrame` with the latest snapshot, coalesced to one
 * call per animation frame. Returns whether a live subscription is active.
 */
export function useRuntimeAudioMeterFrame(
  scope: RuntimeAudioMeterScope | undefined,
  onFrame: (snapshot: AudioMeterSnapshot | undefined) => void,
  options?: RuntimeAudioMeterSubscriptionOptions,
): boolean {
  const onFrameRef = useRef(onFrame);
  const latestRef = useRef<AudioMeterSnapshot | undefined>(undefined);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const kind = scope?.kind;
  const trackId = scope && scope.kind === 'track' ? scope.trackId : undefined;
  const featuresKey = featuresKeyOf(options);
  const dynamicsKey = dynamicsKeyOf(options);

  useEffect(() => {
    if (!kind) {
      latestRef.current = undefined;
      onFrameRef.current?.(undefined);
      return undefined;
    }
    const scopeArg: RuntimeAudioMeterScope = kind === 'master'
      ? { kind: 'master' }
      : { kind: 'track', trackId: trackId as string };

    const flush = () => {
      const next = getScopeSnapshot(scopeArg);
      if (Object.is(next, latestRef.current)) return;
      latestRef.current = next;
      onFrameRef.current?.(latestRef.current);
    };

    latestRef.current = getScopeSnapshot(scopeArg);
    onFrameRef.current?.(latestRef.current);
    const releaseDemand = runtimeAudioMeterBus.retainDemand(scopeArg, optionsRef.current);
    addRuntimeAudioMeterFramePoller(flush);

    return () => {
      releaseDemand();
      removeRuntimeAudioMeterFramePoller(flush);
    };
  }, [kind, trackId, featuresKey, dynamicsKey]);

  return Boolean(kind);
}

/**
 * Subscribe to `scope` and surface the snapshot as React state, throttled to `maxFps`
 * (defaults to one commit per animation frame). Use only where React text/state must
 * update — visual meters should use the ref/frame hooks instead.
 */
export function useRuntimeAudioMeterSnapshot(
  scope: RuntimeAudioMeterScope | undefined,
  options?: RuntimeAudioMeterSubscriptionOptions & { maxFps?: number },
): AudioMeterSnapshot | undefined {
  const [snapshot, setSnapshot] = useState<AudioMeterSnapshot | undefined>(() => getScopeSnapshot(scope));
  const latestRef = useRef<AudioMeterSnapshot | undefined>(snapshot);
  const frameRef = useRef<number | null>(null);
  const lastCommittedAtRef = useRef(0);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const kind = scope?.kind;
  const trackId = scope && scope.kind === 'track' ? scope.trackId : undefined;
  const featuresKey = featuresKeyOf(options);
  const dynamicsKey = dynamicsKeyOf(options);
  const maxFps = options?.maxFps;
  const intervalMs = maxFps && maxFps > 0 ? 1000 / maxFps : 0;

  useEffect(() => {
    if (!kind) {
      if (frameRef.current !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      latestRef.current = undefined;
      return undefined;
    }
    const scopeArg: RuntimeAudioMeterScope = kind === 'master'
      ? { kind: 'master' }
      : { kind: 'track', trackId: trackId as string };

    const commit = () => {
      setSnapshot((current) => (Object.is(current, latestRef.current) ? current : latestRef.current));
    };
    const subscriptionOptions = optionsRef.current
      ? { features: optionsRef.current.features, dynamicsEffectIds: optionsRef.current.dynamicsEffectIds }
      : undefined;

    latestRef.current = getScopeSnapshot(scopeArg);
    commit();
    lastCommittedAtRef.current = nowMs();

    const canRaf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
    if (intervalMs > 0) {
      let timerId: number | null = null;
      let rafId: number | null = null;
      let disposed = false;
      const releaseDemand = runtimeAudioMeterBus.retainDemand(scopeArg, subscriptionOptions);
      const poll = () => {
        if (disposed) return;
        latestRef.current = getScopeSnapshot(scopeArg);
        lastCommittedAtRef.current = nowMs();
        commit();
        timerId = window.setTimeout(() => {
          timerId = null;
          if (canRaf) {
            rafId = window.requestAnimationFrame(() => {
              rafId = null;
              poll();
            });
            return;
          }
          poll();
        }, intervalMs);
      };
      timerId = window.setTimeout(() => {
        timerId = null;
        poll();
      }, intervalMs);
      return () => {
        disposed = true;
        releaseDemand();
        if (timerId !== null) window.clearTimeout(timerId);
        if (rafId !== null && canRaf) window.cancelAnimationFrame(rafId);
        timerId = null;
        rafId = null;
      };
    }

    const flush = (timestamp: number) => {
      frameRef.current = null;
      if (intervalMs > 0 && timestamp - lastCommittedAtRef.current < intervalMs) {
        frameRef.current = window.requestAnimationFrame(flush);
        return;
      }
      lastCommittedAtRef.current = timestamp;
      commit();
    };
    const schedule = () => {
      if (!canRaf) {
        commit();
        return;
      }
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(flush);
    };
    const unsubscribe = subscribeScope(scopeArg, (next) => {
      latestRef.current = next;
      schedule();
    }, subscriptionOptions);

    return () => {
      unsubscribe();
      if (frameRef.current !== null && canRaf) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
    };
  }, [kind, trackId, featuresKey, dynamicsKey, intervalMs]);

  return kind ? snapshot : undefined;
}
