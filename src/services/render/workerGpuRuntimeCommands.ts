import type {
  WorkerGpuGraphId,
  WorkerGpuProjectRenderGraph,
  WorkerGpuRenderGraphDelta,
  WorkerGpuRgba,
  WorkerGpuVector2,
} from './workerGpuRenderGraph';
import type { RuntimeColorGrade } from '../../types/colorCorrection';
import type { Effect } from '../../types/effects';
import type {
  TransitionCenterAxis,
  TransitionDistortion,
  TransitionPatternMask,
  TransitionProceduralMask,
  TransitionShapeMask,
  TransitionWipeDirection,
} from '../../transitions/types';
import type { BlendMode } from '../../types/blendMode';
import type { VideoRotationDegrees } from '../../engine/webcodecs/videoTrackOrientation';
import type { MotionAdjustmentWorkerGpuExecutionPlan } from '../motionDesign/adjustment/workerGpuAdjustmentPlan';
import type { MotionAdjustmentSourceKind } from '../motionDesign/adjustment/sourceContracts';
import {
  collectWorkerGpuFrameStackTransferables,
  type WorkerGpuFrameStackAdmission,
  type WorkerGpuFrameStackContractV1,
} from './workerGpuFrameStackContract';

export type WorkerGpuRuntimeCommandType =
  | 'gpu.registerTarget'
  | 'gpu.unregisterTarget'
  | 'gpu.presentTestPattern'
  | 'gpu.presentWebCodecsFrame'
  | 'gpu.presentFrameStack'
  | 'gpu.startWebCodecsStream'
  | 'gpu.stopWebCodecsStream'
  | 'gpu.initGraph'
  | 'gpu.graphDelta'
  | 'gpu.setClock'
  | 'gpu.renderDeadline'
  | 'gpu.renderFrame'
  | 'gpu.readback'
  | 'gpu.dispose';

export const WORKER_GPU_RUNTIME_COMMAND_TYPES = [
  'gpu.registerTarget',
  'gpu.unregisterTarget',
  'gpu.presentTestPattern',
  'gpu.presentWebCodecsFrame',
  'gpu.presentFrameStack',
  'gpu.startWebCodecsStream',
  'gpu.stopWebCodecsStream',
  'gpu.initGraph',
  'gpu.graphDelta',
  'gpu.setClock',
  'gpu.renderDeadline',
  'gpu.renderFrame',
  'gpu.readback',
  'gpu.dispose',
] as const satisfies readonly WorkerGpuRuntimeCommandType[];

/** Default policy for every command except the explicit frame-stack transport. */
export const WORKER_GPU_RUNTIME_COMMAND_TRANSFER_POLICY = {
  acceptsTransferables: false,
  transferableFields: [],
  payloadKind: 'structured-clone-data-only',
} as const;

export const WORKER_GPU_FRAME_STACK_COMMAND_TRANSFER_POLICY = {
  acceptsTransferables: true,
  transferableFields: [
    'stack.bindings[].payload.bitmap',
    'stack.bindings[].payload.stack (recursive)',
  ] as const,
  payloadKind: 'validated-exact-one-shot-frame-stack',
} as const;

export interface WorkerGpuRuntimeCommandBase {
  readonly type: WorkerGpuRuntimeCommandType;
  readonly commandId: string;
}

export interface WorkerGpuTargetDescriptor {
  readonly targetId: WorkerGpuGraphId;
  readonly compositionId: WorkerGpuGraphId;
  readonly size: WorkerGpuVector2;
  readonly devicePixelRatio: number;
  readonly presentation: 'worker-webgpu';
  readonly colorSpace: 'srgb' | 'display-p3';
  readonly alphaMode: 'opaque' | 'premultiplied';
}

export interface WorkerGpuRegisterTargetCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.registerTarget';
  readonly target: WorkerGpuTargetDescriptor;
}

export interface WorkerGpuUnregisterTargetCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.unregisterTarget';
  readonly targetId: WorkerGpuGraphId;
}

export type WorkerGpuTestPattern =
  | {
      readonly kind: 'solid-color';
      readonly color: WorkerGpuRgba;
    }
  | {
      readonly kind: 'checkerboard';
      readonly firstColor: WorkerGpuRgba;
      readonly secondColor: WorkerGpuRgba;
      readonly cellSize: number;
    }
  | {
      readonly kind: 'frame-index-gradient';
      readonly frameIndex: number;
      readonly firstColor: WorkerGpuRgba;
      readonly secondColor: WorkerGpuRgba;
    };

export interface WorkerGpuPresentTestPatternCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.presentTestPattern';
  readonly targetId: WorkerGpuGraphId;
  readonly timelineTime: number;
  readonly frameIndex: number;
  readonly pattern: WorkerGpuTestPattern;
}

export type WorkerGpuWebCodecsFrameSeekMode = 'seek' | 'scrub' | 'fast' | 'advance' | 'reverse';

export interface WorkerGpuLayerSourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type WorkerGpuTransitionRenderState =
  | {
      readonly kind: 'wipe';
      readonly direction: TransitionWipeDirection;
      readonly progress: number;
    }
  | {
      readonly kind: 'soft-wipe';
      readonly direction: TransitionWipeDirection;
      readonly progress: number;
      readonly angle: number;
      readonly feather: number;
    }
  | {
      readonly kind: 'shape-mask';
      readonly shape: TransitionShapeMask;
      readonly progress: number;
    }
  | {
      readonly kind: 'clock-mask';
      readonly progress: number;
      readonly clockwise: boolean;
      readonly angleOffset: number;
    }
  | {
      readonly kind: 'center-mask';
      readonly axis: TransitionCenterAxis;
      readonly progress: number;
    }
  | {
      readonly kind: 'procedural-mask';
      readonly procedural: TransitionProceduralMask;
      readonly progress: number;
      readonly seed?: number;
    }
  | {
      readonly kind: 'pattern-mask';
      readonly pattern: TransitionPatternMask;
      readonly progress: number;
    }
  | {
      readonly kind: 'distortion';
      readonly distortion: TransitionDistortion;
      readonly progress: number;
      readonly seed?: number;
    };

export interface WorkerGpuWebCodecsRenderLayer {
  readonly id: string;
  readonly name: string;
  readonly sourceClipId?: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blendMode: BlendMode;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly scale: { readonly x: number; readonly y: number; readonly z?: number };
  readonly rotation: number | { readonly x: number; readonly y: number; readonly z: number };
  readonly videoRotation?: VideoRotationDegrees;
  readonly sourceRect?: WorkerGpuLayerSourceRect;
  readonly effects: readonly Effect[];
  readonly colorCorrection?: RuntimeColorGrade;
  readonly maskFeather?: number;
  readonly maskFeatherQuality?: number;
  readonly maskInvert?: boolean;
  readonly maskClipId?: string;
  readonly transitionRender?: WorkerGpuTransitionRenderState;
}

export interface WorkerGpuWebCodecsFrameLayer {
  readonly sourceId: string;
  /** Frozen kind for generic WebCodecs-backed sources; legacy video omits it. */
  readonly sourceKind?: MotionAdjustmentSourceKind;
  readonly mediaTime: number;
  readonly opacity: number;
  readonly blendMode: string;
  readonly renderLayer?: WorkerGpuWebCodecsRenderLayer;
  readonly inlineBrightness?: number;
  readonly inlineContrast?: number;
  readonly inlineSaturation?: number;
  readonly inlineInvert?: boolean;
  readonly hueShift?: number;
  readonly pixelateSize?: number;
  readonly kaleidoscopeSegments?: number;
  readonly kaleidoscopeRotation?: number;
  readonly mirrorHorizontal?: boolean;
  readonly mirrorVertical?: boolean;
  readonly rgbSplitAmount?: number;
  readonly rgbSplitAngle?: number;
  readonly blurRadius?: number;
  readonly exposure?: number;
  readonly exposureOffset?: number;
  readonly exposureGamma?: number;
  readonly temperature?: number;
  readonly tint?: number;
  readonly vibrance?: number;
  readonly thresholdLevel?: number;
  readonly posterizeLevels?: number;
  readonly vignetteAmount?: number;
  readonly vignetteSize?: number;
  readonly vignetteSoftness?: number;
  readonly vignetteRoundness?: number;
  readonly chromaKeyMode?: number;
  readonly chromaKeyTolerance?: number;
  readonly chromaKeySoftness?: number;
  readonly chromaKeySpill?: number;
  readonly scanlineDensity?: number;
  readonly scanlineOpacity?: number;
  readonly scanlineSpeed?: number;
  readonly grainAmount?: number;
  readonly grainSize?: number;
  readonly grainSpeed?: number;
  readonly waveAmplitudeX?: number;
  readonly waveAmplitudeY?: number;
  readonly waveFrequencyX?: number;
  readonly waveFrequencyY?: number;
  readonly twirlAmount?: number;
  readonly twirlRadius?: number;
  readonly twirlCenterX?: number;
  readonly twirlCenterY?: number;
  readonly bulgeAmount?: number;
  readonly bulgeRadius?: number;
  readonly bulgeCenterX?: number;
  readonly bulgeCenterY?: number;
  readonly sharpenAmount?: number;
  readonly sharpenRadius?: number;
  readonly edgeDetectStrength?: number;
  readonly edgeDetectInvert?: boolean;
  readonly glowAmount?: number;
  readonly glowThreshold?: number;
  readonly glowRadius?: number;
  readonly levelsInputBlack?: number;
  readonly levelsInputWhite?: number;
  readonly levelsGamma?: number;
  readonly levelsOutputBlack?: number;
  readonly levelsOutputWhite?: number;
  readonly levelsEnabled?: boolean;
  readonly complexEffectCount?: number;
}

export interface WorkerGpuPresentWebCodecsFrameCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.presentWebCodecsFrame';
  readonly targetId: WorkerGpuGraphId;
  readonly compositionId?: string;
  readonly sourceId: string;
  readonly timelineTime: number;
  readonly mediaTime: number;
  readonly frameIndex: number;
  readonly mode: WorkerGpuWebCodecsFrameSeekMode;
  readonly timeoutMs?: number;
  readonly layers?: readonly WorkerGpuWebCodecsFrameLayer[];
  readonly adjustmentPlan?: MotionAdjustmentWorkerGpuExecutionPlan;
}

/** Atomic mixed-source frame transport. The Worker rebinds admission.nowMs to its own clock. */
export interface WorkerGpuPresentFrameStackCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.presentFrameStack';
  readonly admission: WorkerGpuFrameStackAdmission;
  readonly stack: WorkerGpuFrameStackContractV1;
  /** Optional exact export readback, identity-bound to the frozen frame stack. */
  readonly readback?: WorkerGpuFrameStackReadbackRequest;
}

export interface WorkerGpuFrameStackReadbackRequest {
  readonly readbackId: string;
  readonly targetId: WorkerGpuGraphId;
  readonly compositionId: WorkerGpuGraphId;
  readonly timelineTime: number;
  readonly frameIndex: number;
  readonly width: number;
  readonly height: number;
  readonly format: 'rgba8unorm';
  readonly colorSpace: 'srgb' | 'display-p3';
}

export interface WorkerGpuStartWebCodecsStreamCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.startWebCodecsStream';
  readonly targetId: WorkerGpuGraphId;
  readonly compositionId?: string;
  readonly sourceId: string;
  readonly timelineTime: number;
  readonly mediaTime: number;
  readonly frameIndex: number;
  readonly playbackRate: number;
  readonly targetFps: number;
  readonly timeoutMs?: number;
  readonly layers?: readonly WorkerGpuWebCodecsFrameLayer[];
  /** Transport-compatible only; the Worker boundary rejects this on autonomous streams. */
  readonly adjustmentPlan?: MotionAdjustmentWorkerGpuExecutionPlan;
}

export interface WorkerGpuStopWebCodecsStreamCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.stopWebCodecsStream';
  readonly targetId: WorkerGpuGraphId;
  readonly sourceId?: string;
  readonly reason: string;
}

export interface WorkerGpuInitGraphCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.initGraph';
  readonly graph: WorkerGpuProjectRenderGraph;
}

export interface WorkerGpuGraphDeltaCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.graphDelta';
  readonly delta: WorkerGpuRenderGraphDelta;
}

export interface WorkerGpuClockSnapshot {
  readonly timelineTime: number;
  readonly wallClockTimeMs: number;
  readonly playbackRate: number;
  readonly playing: boolean;
  readonly loop: {
    readonly enabled: boolean;
    readonly start: number;
    readonly end: number;
  } | null;
  readonly audioClockTime: number | null;
  readonly driftMs: number;
}

export interface WorkerGpuSetClockCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.setClock';
  readonly clock: WorkerGpuClockSnapshot;
}

export type WorkerGpuRenderIntent = 'playback' | 'scrub' | 'seek' | 'preview' | 'export' | 'proof';

export interface WorkerGpuRenderDeadline {
  readonly requestId: string;
  readonly targetId: WorkerGpuGraphId;
  readonly compositionId: WorkerGpuGraphId;
  readonly timelineTime: number;
  readonly frameIndex: number;
  readonly intent: WorkerGpuRenderIntent;
  readonly submitByMs: number;
  readonly expireAfterMs: number;
  readonly exact: boolean;
}

export interface WorkerGpuRenderDeadlineCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.renderDeadline';
  readonly deadline: WorkerGpuRenderDeadline;
}

export interface WorkerGpuRenderFrameCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.renderFrame';
  readonly deadline: WorkerGpuRenderDeadline;
  readonly graphVersion: number;
}

export interface WorkerGpuReadbackRequest {
  readonly readbackId: string;
  readonly targetId: WorkerGpuGraphId;
  readonly compositionId: WorkerGpuGraphId;
  readonly timelineTime: number;
  readonly size: WorkerGpuVector2;
  readonly format: 'rgba8unorm';
  readonly colorSpace: 'srgb' | 'display-p3';
}

export interface WorkerGpuReadbackCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.readback';
  readonly request: WorkerGpuReadbackRequest;
}

export interface WorkerGpuDisposeCommand extends WorkerGpuRuntimeCommandBase {
  readonly type: 'gpu.dispose';
  readonly reason: string;
}

export type WorkerGpuRuntimeCommand =
  | WorkerGpuRegisterTargetCommand
  | WorkerGpuUnregisterTargetCommand
  | WorkerGpuPresentTestPatternCommand
  | WorkerGpuPresentWebCodecsFrameCommand
  | WorkerGpuPresentFrameStackCommand
  | WorkerGpuStartWebCodecsStreamCommand
  | WorkerGpuStopWebCodecsStreamCommand
  | WorkerGpuInitGraphCommand
  | WorkerGpuGraphDeltaCommand
  | WorkerGpuSetClockCommand
  | WorkerGpuRenderDeadlineCommand
  | WorkerGpuRenderFrameCommand
  | WorkerGpuReadbackCommand
  | WorkerGpuDisposeCommand;

export function assertWorkerGpuPresentFrameStackCommand(
  command: WorkerGpuPresentFrameStackCommand,
): void {
  void collectPresentFrameStackTransferables(command);
}

function collectPresentFrameStackTransferables(
  command: WorkerGpuPresentFrameStackCommand,
): readonly Transferable[] {
  if (command.commandId !== command.admission.requestId) {
    throw new Error(
      '[MD7_FRAME_STACK_COMMAND_ENVELOPE_INVALID] Frame-stack command id does not match admission',
    );
  }
  const readback = command.readback;
  if (readback) {
    const frame = command.stack.frame;
    if (
      readback.readbackId.length === 0
      || readback.targetId !== frame.targetId
      || readback.compositionId !== frame.compositionId
      || readback.timelineTime !== frame.timelineTime
      || readback.frameIndex !== frame.frameIndex
      || readback.width !== command.stack.dimensions.width
      || readback.height !== command.stack.dimensions.height
      || readback.format !== 'rgba8unorm'
      || (readback.colorSpace !== 'srgb' && readback.colorSpace !== 'display-p3')
    ) {
      throw new Error(
        '[MD7_FRAME_STACK_READBACK_IDENTITY_INVALID] Frame-stack readback does not match its exact frame identity',
      );
    }
  }
  return collectWorkerGpuFrameStackTransferables(command.stack, command.admission);
}

export function collectWorkerGpuRuntimeCommandTransferables(
  command: WorkerGpuRuntimeCommand,
): readonly Transferable[] {
  if (command.type === 'gpu.presentFrameStack') {
    return collectPresentFrameStackTransferables(command);
  }
  return [];
}
