/**
 * What WebGPU startup tried and saw, attached to every diagnostic event as
 * `context.webgpu.startup`. Without it, sessions whose browser has no WebGPU or
 * returns no adapter reported no GPU identity at all: adapter info is only read
 * from a created device. The WebGL renderer string is the one GPU hint that
 * still exists then.
 */
import { Logger } from '../logger';
import { readWebGlDebugAdapterInfo, type WebGlAdapterHint } from '../render/webglAdapterHint';

const log = Logger.create('GpuStartupProbe');

const MAX_ATTEMPTS = 8;

export type GpuAdapterAttemptResult = 'ok' | 'null' | 'timeout' | `rejected:${string}`;

export interface GpuAdapterAttempt {
  label: string;
  result: GpuAdapterAttemptResult;
  ms: number;
}

export interface GpuStartupProbe {
  failure?: string;
  attempts: GpuAdapterAttempt[];
  adapter?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
    isFallbackAdapter?: boolean;
    featureLevel?: string;
  };
  webgl?: WebGlAdapterHint | null;
  /** Why the WebGL hint was not read (it would have blocked the page). */
  webglSkipped?: 'adapter_timeout';
  secureContext?: boolean;
}

let probe: GpuStartupProbe | null = null;

function current(): GpuStartupProbe {
  return (probe ??= { attempts: [] });
}

export function recordGpuAdapterAttempt(label: string, result: GpuAdapterAttemptResult, ms: number): void {
  const attempts = current().attempts;
  if (attempts.length < MAX_ATTEMPTS) attempts.push({ label, result, ms: Math.round(ms) });
}

export function recordGpuAdapter(adapter: GPUAdapter): void {
  const withExtras = adapter as GPUAdapter & { isFallbackAdapter?: boolean; featureLevel?: string };
  let info: Partial<GPUAdapterInfo> | undefined;
  try { info = adapter.info; } catch { info = undefined; }
  const entry = current();
  entry.failure = undefined;
  entry.adapter = {
    vendor: info?.vendor || undefined,
    architecture: info?.architecture || undefined,
    device: info?.device || undefined,
    description: info?.description || undefined,
    isFallbackAdapter: (info as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter ?? withExtras.isFallbackAdapter,
    featureLevel: withExtras.featureLevel,
  };
}

/** Call before logging the failure, so the reported event already carries it. */
export function recordGpuStartupFailure(failure: string): void {
  const entry = current();
  entry.failure = failure;
  entry.secureContext = typeof window !== 'undefined' ? window.isSecureContext : undefined;
  if (entry.webgl !== undefined || entry.webglSkipped) return;
  // After an adapter request timed out, the browser's GPU process is stuck: creating a WebGL context
  // there blocks the main thread until it answers (seconds on Android PowerVR), so skip the hint.
  if (entry.attempts.some((attempt) => attempt.result === 'timeout')) {
    entry.webglSkipped = 'adapter_timeout';
    log.warn('WebGL adapter hint skipped: an adapter request timed out, a WebGL context would block the page.');
    return;
  }
  // Only on failure: creating a WebGL context costs a little and is not needed otherwise.
  entry.webgl = readWebGlDebugAdapterInfo();
}

export function getGpuStartupProbe(): GpuStartupProbe | null {
  return probe;
}

export function resetGpuStartupProbeForTests(): void {
  probe = null;
}
