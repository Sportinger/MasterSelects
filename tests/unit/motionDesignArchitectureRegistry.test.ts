import { describe, expect, it } from 'vitest';

import {
  completeHighConflictOwnership,
  motionDesignActiveWavePackets,
  motionDesignArchitectureGates,
  motionDesignExitCriteriaCoverage,
  motionDesignMd7MixedSourcePackets,
  motionDesignRefactorLanes,
  motionDesignWave2ReviewClosureWindows,
} from '../../src/architecture';

describe('Motion Design architecture registry', () => {
  it('registers the complete ordered MDX gate chain', () => {
    expect(motionDesignArchitectureGates.map((gate) => gate.id)).toEqual([
      'MDX0_BASELINE_CLOSED',
      'MDX1_OWNERSHIP_REGISTERED',
      'MDX2_CONTRACTS_FROZEN',
      'MDX3_FOUNDATIONS_INTEGRATED',
      'MDX4_PROCEDURAL_MEDIA_INTEGRATED',
      'MDX5_REUSABLE_CONTENT_INTEGRATED',
      'MDX6_RELEASE_GREEN',
    ]);
    expect(motionDesignArchitectureGates[0].status).toBe('satisfied');
    expect(motionDesignArchitectureGates[1].status).toBe('satisfied');
    expect(motionDesignArchitectureGates[2].status).toBe('satisfied');
    for (let index = 1; index < motionDesignArchitectureGates.length; index += 1) {
      expect(motionDesignArchitectureGates[index].dependsOn).toEqual([
        motionDesignArchitectureGates[index - 1].id,
      ]);
    }
    expect(motionDesignExitCriteriaCoverage.map((entry) => entry.gateId)).toEqual(
      motionDesignArchitectureGates.map((gate) => gate.id),
    );
  });

  it('keeps the three worker lanes disjoint and outside shared seams', () => {
    const lanesById = new Map(motionDesignRefactorLanes.map((lane) => [lane.id, lane]));
    expect([...lanesById.keys()]).toEqual([
      'motion-design-integration',
      'motion-design-procedural',
      'motion-design-structure-reuse',
      'motion-design-compositor-media',
    ]);

    const workerIds = [
      'motion-design-procedural',
      'motion-design-structure-reuse',
      'motion-design-compositor-media',
    ];
    const exactOwners = new Map<string, string>();
    for (const laneId of workerIds) {
      const lane = lanesById.get(laneId);
      expect(lane).toBeDefined();
      expect(lane?.forbiddenWriteSet).toContain('src/architecture/**');
      expect(lane?.forbiddenWriteSet).toContain('src/types/**');
      expect(lane?.forbiddenWriteSet).toContain('src/stores/**');
      expect(lane?.forbiddenWriteSet).toContain('src/services/project/**');
      expect(lane?.forbiddenWriteSet).toContain('src/services/aiTools/**');
      for (const target of lane?.writeSet ?? []) {
        expect(exactOwners.has(target), `${target} has two Motion worker owners`).toBe(false);
        exactOwners.set(target, laneId);
      }
    }
  });

  it('assigns Motion shared high-conflict seams only to L0', () => {
    const motionOwnership = completeHighConflictOwnership.filter((entry) => (
      entry.path === 'src/types/motionDesign.ts'
      || entry.path === 'src/engine/motion/MotionRenderer.ts'
      || entry.path === 'src/services/motionDesign/contracts/**'
      || entry.path === 'docs/plans/motion-design-md0-md9-multilane-execution-plan.md'
    ));
    expect(motionOwnership).toHaveLength(4);
    expect(new Set(motionOwnership.map((entry) => entry.laneId))).toEqual(
      new Set(['motion-design-integration']),
    );
  });

  it('leases Wave 2 parent persistence and edit seams only to L0', () => {
    const integration = motionDesignRefactorLanes.find(
      (lane) => lane.id === 'motion-design-integration',
    );
    expect(integration?.writeSet).toEqual(expect.arrayContaining([
      'src/types/timeline.ts',
      'src/services/project/types/composition.types.ts',
      'src/services/project/projectSave.ts',
      'src/services/project/load/loadTimelineHydration.ts',
      'src/stores/timeline/clipboard/**',
      'src/stores/timeline/editOperations/deleteOperations.ts',
      'src/stores/timeline/editOperations/splitBatchOperations.ts',
      'src/stores/timeline/serialization/**',
    ]));
    for (const lane of motionDesignRefactorLanes.filter(
      (candidate) => candidate.id !== 'motion-design-integration',
    )) {
      expect(lane.forbiddenWriteSet).toContain('src/stores/**');
      expect(lane.forbiddenWriteSet).toContain('src/services/project/**');
      expect(lane.forbiddenWriteSet).toContain('src/types/**');
    }
  });

  it('registers disjoint leaf-only leases for the final Wave 2 gate closure', () => {
    expect(motionDesignActiveWavePackets.map((packet) => packet.id)).toEqual([
      'MD3_GATE_CLOSURE_AUDIT',
      'MD6_NULL_VIEWPORT_MODEL',
      'MD7_WORKER_GPU_ADJUSTMENT_PLAN',
    ]);
    const paths = motionDesignActiveWavePackets.flatMap((packet) => packet.writeSet);
    expect(new Set(paths).size).toBe(paths.length);
    for (const packet of motionDesignActiveWavePackets) {
      expect(packet.integrationOwner).toBe('L0 Main Integrator');
      expect(packet.forbiddenWriteSet).toEqual(expect.arrayContaining([
        'src/architecture/**',
        'src/types/**',
        'src/stores/**',
        'src/components/**',
        'src/engine/**',
        'src/services/aiTools/**',
        'src/services/project/**',
        'docs/**',
      ]));
    }
  });

  it('records disjoint review leases and returns shared seams to L0 in the next window', () => {
    expect(motionDesignWave2ReviewClosureWindows.map((packet) => packet.id)).toEqual([
      'MD6_NULL_VIEWPORT_MAIN_INTEGRATION',
      'MD7_RUNTIME_ENVELOPE_GATES',
      'MD7_FROZEN_PLAN_MAIN_INTEGRATION',
    ]);
    for (const window of [1, 2] as const) {
      const paths = motionDesignWave2ReviewClosureWindows
        .filter((packet) => packet.window === window)
        .flatMap((packet) => packet.writeSet);
      expect(new Set(paths).size, `review window ${window} has overlapping leases`).toBe(paths.length);
    }
    const l3Envelope = motionDesignWave2ReviewClosureWindows.find(
      (packet) => packet.id === 'MD7_RUNTIME_ENVELOPE_GATES',
    );
    const mainIntegration = motionDesignWave2ReviewClosureWindows.find(
      (packet) => packet.id === 'MD7_FROZEN_PLAN_MAIN_INTEGRATION',
    );
    const reclaimedPaths = l3Envelope?.writeSet.filter((path) => (
      mainIntegration?.writeSet.includes(path)
    ));
    expect(reclaimedPaths).toEqual([
      'src/services/render/workerGpuRuntimeCommands.ts',
      'src/services/render/workerRenderHostRuntimeHandlers.ts',
    ]);
    expect(mainIntegration).toMatchObject({ window: 2, owner: 'L0 Main Integrator' });
  });

  it('registers dependency-ordered and same-window-disjoint MD7 mixed-source packets', () => {
    expect(motionDesignMd7MixedSourcePackets.map((packet) => packet.id)).toEqual([
      'MD7_RECURSIVE_FRAME_STACK_CONTRACT',
      'MD7_GENERIC_PLAN_ADAPTER',
      'MD7_TARGET_RESOURCE_LIFETIME',
      'MD7_FRAME_STACK_HOST_PROJECTOR',
      'MD7_FRAME_STACK_MATERIALIZER',
      'MD7_LAZY_SOURCE_EXECUTOR',
      'MD7_RECURSIVE_STACK_EXECUTOR',
      'MD7_FRAME_STACK_TRANSPORT_ENVELOPE',
      'MD7_FRAME_STACK_SERIAL_INTEGRATION',
      'MD7_FRAME_STACK_VISIBLE_EVIDENCE',
    ]);
    const known = new Set([
      ...motionDesignWave2ReviewClosureWindows.map((packet) => packet.id),
    ] as string[]);
    for (const packet of motionDesignMd7MixedSourcePackets) {
      for (const dependency of packet.dependsOn) {
        expect(known.has(dependency), `${packet.id} has unresolved dependency ${dependency}`).toBe(true);
      }
      known.add(packet.id);
    }
    for (const window of [3, 4, 5, 6, 7] as const) {
      const paths = motionDesignMd7MixedSourcePackets
        .filter((packet) => packet.window === window)
        .flatMap((packet) => packet.writeSet);
      expect(new Set(paths).size, `MD7 window ${window} has overlapping leases`).toBe(paths.length);
    }
    expect(motionDesignMd7MixedSourcePackets.at(-2)).toMatchObject({
      id: 'MD7_FRAME_STACK_SERIAL_INTEGRATION',
      owner: 'L0 Main Integrator',
      window: 6,
    });
  });
});
