import { describe, expect, it } from 'vitest';
import { createReplicatorRenderPacket } from '../../src/engine/motion/replicator';
import {
  createLinearReplicatorContractFixture,
  createReplicatorUnitSourceBounds,
} from '../../src/services/motionDesign/replicator/contractFixtures';
import { evaluateMotionReplicatorReference } from '../../src/services/motionDesign/replicator/referenceEvaluator';

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

describe('MD3 10k performance evidence', () => {
  it('evaluates and packs 10,000 deterministic instances within the CPU budget', () => {
    const contract = createLinearReplicatorContractFixture();
    contract.revision = 10_000;
    contract.layout = { mode: 'linear', count: 10_000, step: { x: 1, y: 0 } };
    contract.userLimit = 10_000;
    const runtimeLimits = {
      deviceMaxInstances: 10_000,
      renderTargetMaxInstances: 10_000,
    };
    const sourceBounds = createReplicatorUnitSourceBounds();
    const samples: number[] = [];
    let encodedBytes = 0;

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const startedAt = performance.now();
      const evaluation = evaluateMotionReplicatorReference(
        contract,
        runtimeLimits,
        sourceBounds,
      );
      expect(evaluation.ok).toBe(true);
      if (!evaluation.ok) return;
      const packet = createReplicatorRenderPacket(evaluation);
      expect(packet.ok).toBe(true);
      if (!packet.ok) return;
      encodedBytes = packet.stats.encodedBytes;
      if (iteration >= 2) samples.push(performance.now() - startedAt);
    }

    const report = {
      scenario: 'linear-10k-reference-evaluate-and-pack',
      samples: samples.length,
      medianMs: Number(percentile(samples, 0.5).toFixed(3)),
      p95Ms: Number(percentile(samples, 0.95).toFixed(3)),
      maxMs: Number(Math.max(...samples).toFixed(3)),
      encodedBytes,
      instances: 10_000,
    };
    console.info(`MD3_PERF_EVIDENCE ${JSON.stringify(report)}`);

    expect(encodedBytes).toBe(10_000 * 12 * Float32Array.BYTES_PER_ELEMENT);
    expect(report.p95Ms).toBeLessThan(1_000);
  });
});
