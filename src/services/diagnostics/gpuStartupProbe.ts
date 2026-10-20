/**
 * What WebGPU startup tried and saw, attached to every diagnostic event as
 * `context.webgpu.startup`. Without it, sessions whose browser has no WebGPU or
 * returns no adapter reported no GPU identity at all: adapter info is only read
 * from a created device. The WebGL renderer string is the one GPU hint that
 * still exists then.
 */
import { readWebGlDebugAdapterInfo, type WebGlAdapterHint } from '../render/webglAdapterHint';

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
  // Only on failure: creating a WebGL context costs a little and is not needed otherwise.
  if (entry.webgl === undefined) entry.webgl = readWebGlDebugAdapterInfo();
}

export function getGpuStartupProbe(): GpuStartupProbe | null {
  return probe;
}

export function resetGpuStartupProbeForTests(): void {
  probe = null;
}
