export interface MotionDesignActivePacket {
  readonly id: string;
  readonly laneId:
    | 'motion-design-procedural'
    | 'motion-design-structure-reuse'
    | 'motion-design-compositor-media';
  readonly gate: 'MD3_REPLICATOR_CORE_COMPLETE' | 'MD6_STRUCTURE_COMPLETE' | 'MD7_ADJUSTMENT_LAYERS_COMPLETE';
  readonly writeSet: readonly string[];
  readonly forbiddenWriteSet: readonly string[];
  readonly integrationOwner: 'L0 Main Integrator';
}

/**
 * Exact same-worktree leases for the final Wave 2 gate-closure pass. Workers
 * stay in leaf domains; L0 retains browser evidence and every shared UI/render
 * seam. These leases expire when MDX3 is either closed or re-audited.
 */
export const motionDesignActiveWavePackets = [
  {
    id: 'MD3_GATE_CLOSURE_AUDIT',
    laneId: 'motion-design-procedural',
    gate: 'MD3_REPLICATOR_CORE_COMPLETE',
    writeSet: [
      'src/services/motionDesign/replicator/**',
      'tests/unit/motionReplicatorGateClosure*.test.ts',
    ],
    forbiddenWriteSet: [
      'src/architecture/**',
      'src/types/**',
      'src/stores/**',
      'src/components/**',
      'src/engine/**',
      'src/services/aiTools/**',
      'src/services/project/**',
      'docs/**',
    ],
    integrationOwner: 'L0 Main Integrator',
  },
  {
    id: 'MD6_NULL_VIEWPORT_MODEL',
    laneId: 'motion-design-structure-reuse',
    gate: 'MD6_STRUCTURE_COMPLETE',
    writeSet: [
      'src/services/motionDesign/structure/nullViewportController.ts',
      'tests/unit/motionParentViewportControllerMd6.test.ts',
    ],
    forbiddenWriteSet: [
      'src/architecture/**',
      'src/types/**',
      'src/stores/**',
      'src/components/**',
      'src/engine/**',
      'src/services/aiTools/**',
      'src/services/project/**',
      'docs/**',
    ],
    integrationOwner: 'L0 Main Integrator',
  },
  {
    id: 'MD7_WORKER_GPU_ADJUSTMENT_PLAN',
    laneId: 'motion-design-compositor-media',
    gate: 'MD7_ADJUSTMENT_LAYERS_COMPLETE',
    writeSet: [
      'src/services/motionDesign/adjustment/workerGpuAdjustmentPlan.ts',
      'tests/unit/motionAdjustmentWorkerGpuPlanMd7.test.ts',
    ],
    forbiddenWriteSet: [
      'src/architecture/**',
      'src/types/**',
      'src/stores/**',
      'src/components/**',
      'src/engine/**',
      'src/services/render/**',
      'src/services/aiTools/**',
      'src/services/project/**',
      'docs/**',
    ],
    integrationOwner: 'L0 Main Integrator',
  },
] as const satisfies readonly MotionDesignActivePacket[];

export interface MotionDesignWave2ReviewClosureWindow {
  readonly window: 1 | 2;
  readonly id:
    | 'MD6_NULL_VIEWPORT_MAIN_INTEGRATION'
    | 'MD7_RUNTIME_ENVELOPE_GATES'
    | 'MD7_FROZEN_PLAN_MAIN_INTEGRATION';
  readonly owner: 'L0 Main Integrator' | 'L3 Compositor And Media';
  readonly writeSet: readonly string[];
}

/**
 * Sequential review-closure windows after the three leaf packets handed off.
 * A path may reappear only in a later window when ownership has returned to L0
 * for shared-seam integration; leases inside the same window stay disjoint.
 */
export const motionDesignWave2ReviewClosureWindows = [
  {
    window: 1,
    id: 'MD6_NULL_VIEWPORT_MAIN_INTEGRATION',
    owner: 'L0 Main Integrator',
    writeSet: [
      'src/components/preview/useMotionNullViewportEditing.ts',
      'src/components/preview/MotionNullViewportOverlay.tsx',
      'src/components/preview/PreviewCanvasMount.tsx',
      'src/components/preview/Preview.tsx',
      'src/services/layerBuilder/FrameContext.ts',
      'src/services/motionDesign/contracts/timelineStructureAdapter.ts',
      'tests/unit/motionNullViewportOverlayMd6.test.tsx',
      'tests/unit/motionParentBuilderParityMd6.test.ts',
    ],
  },
  {
    window: 1,
    id: 'MD7_RUNTIME_ENVELOPE_GATES',
    owner: 'L3 Compositor And Media',
    writeSet: [
      'src/services/render/workerGpuAdjustmentEnvelope.ts',
      'src/services/render/workerGpuRuntimeCommands.ts',
      'src/services/render/workerRenderHostRuntimeHandlers.ts',
      'tests/unit/workerGpuAdjustmentEnvelopeMd7.test.ts',
    ],
  },
  {
    window: 2,
    id: 'MD7_FROZEN_PLAN_MAIN_INTEGRATION',
    owner: 'L0 Main Integrator',
    writeSet: [
      'src/engine/texture/MaskTextureManager.ts',
      'src/services/render/workerGpuAdjustmentMaskRenderer.ts',
      'src/services/render/workerGpuAdjustmentPlanExecutor.ts',
      'src/services/render/workerGpuRuntimeCommands.ts',
      'src/services/render/workerGpuVideoFrameCompositor.ts',
      'src/services/render/workerGpuVideoFrameLayerPresenter.ts',
      'src/services/render/workerPresentingRenderHostPort.ts',
      'src/services/render/workerRenderHostRuntimeBridge.ts',
      'src/services/render/workerRenderHostRuntimeCommands.ts',
      'src/services/render/workerRenderHostRuntimeHandlers.ts',
      'tests/unit/workerGpuAdjustmentIntegrationMd7.test.ts',
      'tests/unit/workerPresentingRenderHostPort.test.ts',
    ],
  },
] as const satisfies readonly MotionDesignWave2ReviewClosureWindow[];

export interface MotionDesignMd7MixedSourcePacket {
  readonly window: 3 | 4 | 5 | 6 | 7;
  readonly id:
    | 'MD7_RECURSIVE_FRAME_STACK_CONTRACT'
    | 'MD7_GENERIC_PLAN_ADAPTER'
    | 'MD7_TARGET_RESOURCE_LIFETIME'
    | 'MD7_FRAME_STACK_HOST_PROJECTOR'
    | 'MD7_FRAME_STACK_MATERIALIZER'
    | 'MD7_LAZY_SOURCE_EXECUTOR'
    | 'MD7_RECURSIVE_STACK_EXECUTOR'
    | 'MD7_FRAME_STACK_TRANSPORT_ENVELOPE'
    | 'MD7_FRAME_STACK_SERIAL_INTEGRATION'
    | 'MD7_FRAME_STACK_VISIBLE_EVIDENCE';
  readonly owner: 'L0 Main Integrator' | 'L3 Compositor And Media';
  readonly dependsOn: readonly string[];
  readonly writeSet: readonly string[];
}

/**
 * Exact post-review packets for the remaining mixed-source Worker GPU gate.
 * Same-window writes are disjoint; shared render seams return to L0 only in
 * the later serial-integration window.
 */
export const motionDesignMd7MixedSourcePackets = [
  {
    window: 3,
    id: 'MD7_RECURSIVE_FRAME_STACK_CONTRACT',
    owner: 'L3 Compositor And Media',
    dependsOn: ['MD7_FROZEN_PLAN_MAIN_INTEGRATION'],
    writeSet: [
      'src/services/render/workerGpuFrameStackContract.ts',
      'tests/unit/workerGpuFrameStackContractMd7.test.ts',
    ],
  },
  {
    window: 3,
    id: 'MD7_GENERIC_PLAN_ADAPTER',
    owner: 'L3 Compositor And Media',
    dependsOn: ['MD7_FROZEN_PLAN_MAIN_INTEGRATION'],
    writeSet: [
      'src/services/render/workerGpuAdjustmentPlanAdapter.ts',
      'tests/unit/workerGpuAdjustmentMixedSourcePlanMd7.test.ts',
    ],
  },
  {
    window: 3,
    id: 'MD7_TARGET_RESOURCE_LIFETIME',
    owner: 'L0 Main Integrator',
    dependsOn: ['MD7_FROZEN_PLAN_MAIN_INTEGRATION'],
    writeSet: [
      'src/services/render/workerGpuVideoFrameCompositor.ts',
      'src/services/render/workerGpuVideoFrameLayerPresenter.ts',
      'src/services/render/workerRenderHostRuntimeHandlers.ts',
      'tests/unit/workerGpuTargetResourceLifetimeMd7.test.ts',
    ],
  },
  {
    window: 4,
    id: 'MD7_FRAME_STACK_HOST_PROJECTOR',
    owner: 'L0 Main Integrator',
    dependsOn: ['MD7_RECURSIVE_FRAME_STACK_CONTRACT'],
    writeSet: [
      'src/services/render/workerGpuFrameStackProjector.ts',
      'tests/unit/workerGpuFrameStackProjectorMd7.test.ts',
    ],
  },
  {
    window: 4,
    id: 'MD7_FRAME_STACK_MATERIALIZER',
    owner: 'L3 Compositor And Media',
    dependsOn: ['MD7_RECURSIVE_FRAME_STACK_CONTRACT'],
    writeSet: [
      'src/services/render/workerGpuFrameStackMaterializer.ts',
      'tests/unit/workerGpuFrameStackMaterializerMd7.test.ts',
    ],
  },
  {
    window: 4,
    id: 'MD7_LAZY_SOURCE_EXECUTOR',
    owner: 'L3 Compositor And Media',
    dependsOn: ['MD7_RECURSIVE_FRAME_STACK_CONTRACT'],
    writeSet: [
      'src/services/render/workerGpuAdjustmentPlanExecutor.ts',
      'tests/unit/workerGpuAdjustmentIntegrationMd7.test.ts',
    ],
  },
  {
    window: 5,
    id: 'MD7_RECURSIVE_STACK_EXECUTOR',
    owner: 'L3 Compositor And Media',
    dependsOn: ['MD7_FRAME_STACK_MATERIALIZER', 'MD7_LAZY_SOURCE_EXECUTOR'],
    writeSet: [
      'src/services/render/workerGpuFrameStackExecutor.ts',
      'tests/unit/workerGpuFrameStackExecutorMd7.test.ts',
    ],
  },
  {
    window: 5,
    id: 'MD7_FRAME_STACK_TRANSPORT_ENVELOPE',
    owner: 'L0 Main Integrator',
    dependsOn: ['MD7_RECURSIVE_FRAME_STACK_CONTRACT'],
    writeSet: [
      'src/services/render/workerGpuRuntimeCommands.ts',
      'src/services/render/workerRenderHostRuntimeCommands.ts',
      'src/services/render/workerGpuAdjustmentEnvelope.ts',
      'tests/unit/workerGpuAdjustmentEnvelopeMd7.test.ts',
      'tests/unit/workerGpuFrameStackTransportMd7.test.ts',
    ],
  },
  {
    window: 6,
    id: 'MD7_FRAME_STACK_SERIAL_INTEGRATION',
    owner: 'L0 Main Integrator',
    dependsOn: [
      'MD7_FRAME_STACK_HOST_PROJECTOR',
      'MD7_RECURSIVE_STACK_EXECUTOR',
      'MD7_FRAME_STACK_TRANSPORT_ENVELOPE',
    ],
    writeSet: [
      'src/services/render/workerPresentingRenderHostPort.ts',
      'src/services/render/workerRenderHostRuntimeBridge.ts',
      'src/services/render/workerRenderHostRuntimeHandlers.ts',
      'src/services/render/workerGpuVideoFrameCompositor.ts',
      'tests/unit/workerPresentingRenderHostPort.test.ts',
      'tests/unit/workerRenderHostRuntime.test.ts',
    ],
  },
  {
    window: 7,
    id: 'MD7_FRAME_STACK_VISIBLE_EVIDENCE',
    owner: 'L0 Main Integrator',
    dependsOn: ['MD7_FRAME_STACK_SERIAL_INTEGRATION'],
    writeSet: [
      'docs/evidence/motion-design/md7-adjustment-render-graph.md',
      'docs/plans/motion-design-md0-md9-multilane-execution-plan.md',
    ],
  },
] as const satisfies readonly MotionDesignMd7MixedSourcePacket[];
