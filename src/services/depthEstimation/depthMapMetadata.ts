import type { DepthMapMetadata } from '../../types/depthMap';

export function readDepthMapMetadata(value: unknown): DepthMapMetadata | undefined {
  if (!value || typeof value !== 'object') return;
  const m = value as DepthMapMetadata;
  if (m.version !== 1 || ![m.sourceMediaId, m.sourceFingerprint, m.model, m.modelRevision].every(s => typeof s === 'string' && s.length > 0)
    || ![m.sourceStart, m.sourceEnd, m.fps, m.edge, m.rangeSmoothing].every(Number.isFinite)
    || m.sourceStart < 0 || m.sourceEnd <= m.sourceStart || m.sourceEnd - m.sourceStart > 120
    || ![10, 15, 30].includes(m.fps) || m.edge <= 0 || m.rangeSmoothing < 0 || m.rangeSmoothing > 1
    || typeof m.nearIsWhite !== 'boolean') return;
  return { version: 1, sourceMediaId: m.sourceMediaId, sourceFingerprint: m.sourceFingerprint,
    sourceStart: m.sourceStart, sourceEnd: m.sourceEnd, fps: m.fps, nearIsWhite: m.nearIsWhite,
    model: m.model, modelRevision: m.modelRevision, edge: m.edge, rangeSmoothing: m.rangeSmoothing };
}
