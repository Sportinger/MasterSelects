import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { isLinearTemporalGraph } from './linearTemporalGraph';
import { slitScanNumber } from './slit-scan/parameters';
import { hybridTemporalWindow } from './hybridTemporalWindow';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';

export type ScanAxis = number; // angle in degrees

/** Fail closed on authored graphs and time-varying spatial fields. They retain Hybrid. */
export function linearTemporalAxis(request: SourceTemporalRequest, graph: EffectOperatorGraph,
  params: Record<string, unknown>, step?: number): ScanAxis | undefined {
  // Shared-source blocks composite without per-pixel motion; keep per-frame parity.
  if (params.rgbTimeMode === 'separate' || params.temporalMotion === 'motion') return undefined;
  if (params.temporalBatch !== 'block' || !step || request.maxEdge || request.stabilization || request.horizon <= 0
    || (params.profile ?? 'linear') !== 'linear' || (params.preview ?? 'result') !== 'result'
    || slitScanNumber(params, 'protect') > 0 || slitScanNumber(params, 'bands') > 1
    || slitScanNumber(params, 'mapAmount') > 0 || params.protectionMask
    || slitScanNumber(params, 'centerX') !== 0.5 || slitScanNumber(params, 'centerY') !== 0.5) return undefined;
  const angle = ((slitScanNumber(params, 'angle') % 360) + 360) % 360;
  if (!isLinearTemporalGraph(graph)) return undefined;
  return angle;
}

/** Reserve output tiles separately from the source atlas, inside the existing budget. */
export function linearTemporalBlockMemory(width: number, height: number, availableBytes: number) {
  const perFrame = width * height * 8 + (8192 + 1) * 16;
  const count = Math.min(100, Math.floor(availableBytes / perFrame));
  return count >= 2 ? { count, bytes: count * perFrame } : { count: 0, bytes: 0 };
}

export function linearTemporalBlockPlan(request: SourceTemporalRequest, frames: readonly { time: number; duration: number }[],
  step: number, count: number) {
  return Array.from({ length: count }, (_, i) => request.source.localTime + i * step * (request.source.clockRate ?? 1))
    .filter((time, i) => i === 0 || time < request.source.duration)
    .map(localTime => ({ localTime, ...hybridTemporalWindow({ ...request, source: { ...request.source, localTime } }, frames) }));
}

/** Conservative strip bounds include both neighboring grid weights and spatial filter edges. */
export function linearTemporalStrip(metadata: Float32Array, group: number, delay: number,
  axis: ScanAxis, width: number, height: number): [number, number, number, number] | undefined {
  const count = metadata[metadata.length - 4];
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < count; i++) {
    if (metadata[i * 4 + 1] !== group && metadata[i * 4 + 2] !== group) continue;
    low = Math.min(low, metadata[Math.max(0, i - 1) * 4]);
    high = Math.max(high, i + 1 < count ? metadata[(i + 1) * 4] : delay);
  }
  return stripBounds(low, high, delay, axis, width, height);
}

/** Resolve every source's temporal bounds in one pass, even for 100 output tiles. */
export function linearTemporalStrips(metadata: Float32Array, delay: number, axis: ScanAxis, width: number, height: number) {
  const count = metadata[metadata.length - 4], bounds = new Map<number, [number, number]>();
  for (let i = 0; i < count; i++) for (const group of [metadata[i * 4 + 1], metadata[i * 4 + 2]]) {
    if (!group) continue;
    const [low, high] = bounds.get(group) ?? [Infinity, -Infinity];
    bounds.set(group, [Math.min(low, metadata[Math.max(0, i - 1) * 4]),
      Math.max(high, i + 1 < count ? metadata[(i + 1) * 4] : delay)]);
  }
  return new Map([...bounds].map(([group, [low, high]]) => [group, stripBounds(low, high, delay, axis, width, height)]));
}

function stripBounds(low: number, high: number, delay: number, axis: ScanAxis, width: number, height: number): [number, number, number, number] | undefined {
  if (high < 0 || low > delay) return undefined;
  const start = Math.max(0, low / delay), end = Math.min(1, high / delay);
  const cosine = Math.cos(axis * Math.PI / 180), sine = Math.sin(axis * Math.PI / 180);
  const position = ([x, y]: number[]) => ((x - .5) * cosine + (y - .5) * sine) / (Math.abs(cosine) + Math.abs(sine)) + .5;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const points = corners.filter(point => position(point) >= start - 1e-7 && position(point) <= end + 1e-7);
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], p = position(a), delta = position(b) - p;
    if (Math.abs(delta) < 1e-10) continue;
    for (const edge of [start, end]) {
      const t = (edge - p) / delta;
      if (t >= -1e-7 && t <= 1 + 1e-7) points.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  if (!points.length) return undefined;
  const x = Math.max(0, Math.floor(Math.min(...points.map(p => p[0])) * width) - 1);
  const y = Math.max(0, Math.floor(Math.min(...points.map(p => p[1])) * height) - 1);
  const right = Math.min(width, Math.ceil(Math.max(...points.map(p => p[0])) * width) + 1);
  const bottom = Math.min(height, Math.ceil(Math.max(...points.map(p => p[1])) * height) + 1);
  return right > x && bottom > y ? [x, y, right - x, bottom - y] : undefined;
}
