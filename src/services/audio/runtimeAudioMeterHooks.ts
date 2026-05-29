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
  const frameRef = useRef<number | null>(null);
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

    const canRaf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
    const flush = () => {
      frameRef.current = null;
      onFrameRef.current?.(latestRef.current);
    };
    const schedule = () => {
      if (!canRaf) {
        flush();
        return;
      }
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(flush);
    };

    latestRef.current = getScopeSnapshot(scopeArg);
    onFrameRef.current?.(latestRef.current);

    const unsubscribe = subscribeScope(scopeArg, (snapshot) => {
      latestRef.current = snapshot;
      schedule();
    }, optionsRef.current);

    return () => {
      unsubscribe();
      if (frameRef.current !== null && canRaf) {
        window.cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
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

    latestRef.current = getScopeSnapshot(scopeArg);
    commit();
    lastCommittedAtRef.current = nowMs();

    const canRaf = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
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

    const subscriptionOptions = optionsRef.current
      ? { features: optionsRef.current.features, dynamicsEffectIds: optionsRef.current.dynamicsEffectIds }
      : undefined;
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
