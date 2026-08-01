import type { CompleteRefactorLane } from './types';

const MDX0 = 'MDX0_BASELINE_CLOSED';
const MDX1 = 'MDX1_OWNERSHIP_REGISTERED';
const MDX2 = 'MDX2_CONTRACTS_FROZEN';
const MDX3 = 'MDX3_FOUNDATIONS_INTEGRATED';
const MDX4 = 'MDX4_PROCEDURAL_MEDIA_INTEGRATED';
const MDX5 = 'MDX5_REUSABLE_CONTENT_INTEGRATED';
const MDX6 = 'MDX6_RELEASE_GREEN';

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

/**
 * Persistent Motion Design ownership. Contract workers write only new leaf
 * modules; the integration lane retains every shared store, renderer, project,
 * UI, AI, registry, and documentation seam.
 */
export const motionDesignRefactorLanes = [
  {
    id: 'motion-design-integration',
    name: 'Motion Design Contracts, Integration, And Gates',
    owner: 'L0 Main Integrator',
    status: 'active',
    writeSet: [
      'src/architecture/motionDesign*.ts',
      'src/services/motionDesign/contracts/**',
      'src/types/motionDesign.ts',
      'src/types/timeline.ts',
      'src/services/project/types/**motion*',
      'src/services/project/types/composition.types.ts',
      'src/services/project/projectSave.ts',
      'src/services/project/load/loadTimelineHydration.ts',
      'src/stores/timeline/motionClipSlice.ts',
      'src/stores/timeline/clipSlice.ts',
      'src/stores/timeline/clipboardSlice.ts',
      'src/stores/timeline/clipboard/**',
      'src/stores/timeline/historyTimelineEditState.ts',
      'src/stores/timeline/historyTimelineRestoreState.ts',
      'src/stores/timeline/nestedRestore.ts',
      'src/stores/timeline/editOperations/deleteOperations.ts',
      'src/stores/timeline/editOperations/splitBatchOperations.ts',
      'src/stores/timeline/serialization/**',
      'src/services/properties/motionReplicatorProperties.ts',
      'src/services/properties/motionDesignProperties.ts',
      'src/services/motionDesign/mvpCapabilities.ts',
      'src/utils/motionInterpolation.ts',
      'src/components/panels/properties/MotionShapeTab.tsx',
      'src/engine/motion/MotionTypes.ts',
      'src/engine/motion/MotionFrameRuntime.ts',
      'src/engine/motion/MotionBuffers.ts',
      'src/engine/motion/MotionPipeline.ts',
      'src/engine/motion/MotionRenderer.ts',
      'src/engine/motion/shaders/motionShapes.wgsl',
      'src/engine/render/RenderDispatcher.ts',
      'src/engine/render/NestedCompRenderer.ts',
      'src/engine/render/dispatcher/targetPreviewRenderer.ts',
      'src/engine/render/dispatcher/targetPreviewLayerCollector.ts',
      'src/engine/render/layerCollector/staticSourceCollectors.ts',
      'src/engine/WebGPUEngine.ts',
      'src/engine/export/ExportRenderSessionImpl.ts',
      'src/engine/export/FrameExporter.ts',
      'src/engine/export/exportRenderHostPort.ts',
      'src/services/render/renderHostTypes.ts',
      'src/services/render/mainFallbackRenderHostPort.ts',
      'src/services/render/workerShadowRenderHostPort.ts',
      'src/services/render/workerPresentingRenderHostPort.ts',
      'src/services/renderScheduler.ts',
      'src/services/aiTools/**motionDesign*',
      'src/services/flashboard/FlashBoardChatPrompt.ts',
      'src/services/flashboard/FlashBoardChatPlaybooks.ts',
      'tests/unit/motionDesignArchitectureRegistry.test.ts',
      'tests/unit/motionFrameStateContractFreeze.test.ts',
      'tests/unit/motionFrameRuntimeIntegration.test.ts',
      'tests/unit/motionDesignRendering.test.ts',
      'tests/unit/exportRenderSession.test.ts',
      'tests/unit/exportRenderHostPortWorker.test.ts',
      'tests/unit/motionDesignMd1Lifecycle.test.ts',
      'docs/Features/Motion-Design.md',
      'docs/plans/motion-design-*.md',
      'docs/evidence/motion-design/**',
    ],
    forbiddenWriteSet: [
      'src/services/motionDesign/replicator/**',
      'src/services/motionDesign/modifiers/**',
      'src/services/motionDesign/structure/**',
      'src/services/motionDesign/presets/**',
      'src/services/motionDesign/templates/**',
      'src/services/motionDesign/expressions/**',
      'src/services/motionDesign/adjustment/**',
      'src/services/motionDesign/media/**',
    ],
    highConflictFiles: [
      'src/types/motionDesign.ts',
      'src/stores/timeline/motionClipSlice.ts',
      'src/engine/motion/MotionRenderer.ts',
      'docs/plans/motion-design-md0-md9-multilane-execution-plan.md',
    ],
    exitGates: [MDX0, MDX1, MDX2, MDX3, MDX4, MDX5, MDX6],
  },
  {
    id: 'motion-design-procedural',
    name: 'Motion Design Replicators, Modifiers, And Falloffs',
    owner: 'L1 Procedural Instances',
    status: 'active',
    writeSet: [
      'src/services/motionDesign/replicator/**',
      'src/services/motionDesign/modifiers/**',
      'src/engine/motion/replicator/**',
      'tests/unit/motionReplicator*.test.ts',
      'tests/unit/motionModifier*.test.ts',
    ],
    forbiddenWriteSet: [
      'src/architecture/**',
      'src/types/**',
      'src/stores/**',
      'src/services/project/**',
      'src/services/aiTools/**',
      'src/components/**',
      'src/engine/motion/MotionRenderer.ts',
      'src/engine/render/**',
      'src/engine/export/**',
    ],
    exitGates: [MDX2, MDX3, MDX4, MDX6],
    activeUntilGate: MDX6,
  },
  {
    id: 'motion-design-structure-reuse',
    name: 'Motion Design Structure, Presets, Templates, And Expressions',
    owner: 'L2 Structure And Reuse',
    status: 'active',
    writeSet: [
      'src/services/motionDesign/structure/**',
      'src/services/motionDesign/presets/**',
      'src/services/motionDesign/templates/**',
      'src/services/motionDesign/expressions/**',
      'tests/unit/motionParentGraph*.test.ts',
      'tests/unit/motionPreset*.test.ts',
      'tests/unit/motionTemplate*.test.ts',
      'tests/unit/motionExpression*.test.ts',
    ],
    forbiddenWriteSet: [
      'src/architecture/**',
      'src/types/**',
      'src/stores/**',
      'src/services/project/**',
      'src/services/aiTools/**',
      'src/components/**',
      'src/engine/**',
      'src/utils/transformComposition.ts',
    ],
    exitGates: [MDX2, MDX3, MDX5, MDX6],
    activeUntilGate: MDX6,
  },
  {
    id: 'motion-design-compositor-media',
    name: 'Motion Design Adjustment Compositor And Media Motion',
    owner: 'L3 Compositor And Media',
    status: 'active',
    writeSet: [
      'src/services/motionDesign/adjustment/**',
      'src/services/motionDesign/media/**',
      'src/engine/motion/media/**',
      'tests/unit/motionAdjustment*.test.ts',
      'tests/unit/motionMedia*.test.ts',
    ],
    forbiddenWriteSet: [
      'src/architecture/**',
      'src/types/**',
      'src/stores/**',
      'src/services/project/**',
      'src/services/aiTools/**',
      'src/components/**',
      'src/engine/render/**',
      'src/engine/export/**',
      'src/engine/core/types.ts',
    ],
    exitGates: [MDX2, MDX3, MDX4, MDX5, MDX6],
    activeUntilGate: MDX6,
  },
] as const satisfies readonly CompleteRefactorLane[];
