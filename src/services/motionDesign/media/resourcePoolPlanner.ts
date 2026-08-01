import {
  MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES,
  MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES,
  MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES,
  MOTION_MEDIA_MAX_EVALUATIONS_PER_POOL_PLAN,
  MOTION_MEDIA_POOL_PLAN_VERSION,
  type MotionMediaDiagnostic,
  type MotionMediaDecoderPoolIdentity,
  type MotionMediaFramePoolIdentity,
  type MotionMediaFrameEvaluation,
  type MotionMediaPoolRequestPlan,
  type MotionMediaResourcePoolPlan,
} from './contracts';
import { assertMotionMediaFrameEvaluation } from './evaluationPlanner';
import {
  buildMotionMediaDecoderPoolIdentity,
  buildMotionMediaFramePoolIdentity,
} from './reuseKeyPlanner';
import { assertMotionMediaInertJson } from './contractSafety';

export function planMotionMediaResourcePools(
  evaluations: readonly MotionMediaFrameEvaluation[],
): MotionMediaResourcePoolPlan {
  const rawEvaluations: unknown = evaluations;
  assertMotionMediaInertJson(rawEvaluations);
  if (
    !Array.isArray(rawEvaluations)
    || rawEvaluations.length > MOTION_MEDIA_MAX_EVALUATIONS_PER_POOL_PLAN
  ) {
    throw new Error('Motion media pool plan request count exceeds its hard budget');
  }
  // Complete preflight keeps malformed requests from producing a partial plan.
  const validatedEvaluations: MotionMediaFrameEvaluation[] = [];
  for (const evaluation of rawEvaluations) {
    assertMotionMediaFrameEvaluation(evaluation);
    validatedEvaluations.push(evaluation);
  }

  const readyEvaluations = validatedEvaluations.filter(
    (evaluation) => evaluation.status === 'ready',
  );
  const uniqueRequestedFrameIdentities = new Set(
    readyEvaluations.map((evaluation) =>
      buildMotionMediaFramePoolIdentity(
        evaluation.sourceId,
        evaluation.reuseKey,
        evaluation.bindingRevision,
      ).identityKey),
  );
  const uniqueVideoBindingsRequested = new Set(
    readyEvaluations
      .filter((evaluation) => evaluation.sourceKind === 'video')
      .map((evaluation) =>
        buildMotionMediaDecoderPoolIdentity(
          evaluation.sourceId,
          evaluation.bindingRevision,
        ).identityKey),
  );

  const admittedFrames = new Map<string, MotionMediaFramePoolIdentity>();
  const admittedDecoders = new Map<string, MotionMediaDecoderPoolIdentity>();
  const requests: MotionMediaPoolRequestPlan[] = [];
  let admittedEstimatedBytes = 0;

  for (const [requestIndex, evaluation] of validatedEvaluations.entries()) {
    if (evaluation.status === 'unavailable') {
      requests.push({
        requestIndex,
        sourceId: evaluation.sourceId,
        sourceKind: evaluation.sourceKind,
        bindingRevision: evaluation.bindingRevision,
        reuseKey: null,
        frameIdentityKey: null,
        decoderIdentityKey: null,
        status: 'unavailable',
        reusesFrame: false,
        reusesDecoder: false,
        diagnostics: evaluation.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      });
      continue;
    }

    const frameIdentity = buildMotionMediaFramePoolIdentity(
      evaluation.sourceId,
      evaluation.reuseKey,
      evaluation.bindingRevision,
    );
    const reusesFrame = admittedFrames.has(frameIdentity.identityKey);
    const needsDecoder = evaluation.sourceKind === 'video';
    const decoderIdentity = needsDecoder
      ? buildMotionMediaDecoderPoolIdentity(
        evaluation.sourceId,
        evaluation.bindingRevision,
      )
      : null;
    const reusesDecoder = decoderIdentity !== null
      && admittedDecoders.has(decoderIdentity.identityKey);
    const estimatedFrameBytes = estimateFrameBytes(evaluation);
    const diagnostics: MotionMediaDiagnostic[] = [];

    if (
      needsDecoder
      && !reusesDecoder
      && admittedDecoders.size
        >= MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES
    ) {
      diagnostics.push(createBudgetDiagnostic(
        'DECODER_POOL_BUDGET_EXCEEDED',
        evaluation.sourceId,
        `Decoder pool hard limit is ${MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES}`,
      ));
    }
    if (!reusesFrame && (
      admittedFrames.size >= MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES
      || admittedEstimatedBytes + estimatedFrameBytes
        > MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES
    )) {
      diagnostics.push(createBudgetDiagnostic(
        'FRAME_POOL_BUDGET_EXCEEDED',
        evaluation.sourceId,
        `Frame pool hard limits are ${MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES} unique frames and ${MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES} estimated bytes`,
      ));
    }
    if (diagnostics.length > 0) {
      requests.push({
        requestIndex,
        sourceId: evaluation.sourceId,
        sourceKind: evaluation.sourceKind,
        bindingRevision: evaluation.bindingRevision,
        reuseKey: evaluation.reuseKey,
        frameIdentityKey: frameIdentity.identityKey,
        decoderIdentityKey: decoderIdentity?.identityKey ?? null,
        status: 'rejected',
        reusesFrame: false,
        reusesDecoder: false,
        diagnostics,
      });
      continue;
    }

    admittedFrames.set(frameIdentity.identityKey, frameIdentity);
    if (!reusesFrame) admittedEstimatedBytes += estimatedFrameBytes;
    if (decoderIdentity) {
      admittedDecoders.set(decoderIdentity.identityKey, decoderIdentity);
    }
    requests.push({
      requestIndex,
      sourceId: evaluation.sourceId,
      sourceKind: evaluation.sourceKind,
      bindingRevision: evaluation.bindingRevision,
      reuseKey: evaluation.reuseKey,
      frameIdentityKey: frameIdentity.identityKey,
      decoderIdentityKey: decoderIdentity?.identityKey ?? null,
      status: 'admitted',
      reusesFrame,
      reusesDecoder,
      diagnostics: [],
    });
  }

  return {
    contractVersion: MOTION_MEDIA_POOL_PLAN_VERSION,
    framePool: {
      hardLimit: MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES,
      hardEstimatedByteLimit: MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES,
      uniqueIdentitiesRequested: uniqueRequestedFrameIdentities.size,
      admittedEstimatedBytes,
      admittedFrames: [...admittedFrames.values()],
    },
    decoderPool: {
      hardLimit: MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES,
      uniqueBindingsRequested: uniqueVideoBindingsRequested.size,
      admittedDecoders: [...admittedDecoders.values()],
    },
    requests,
  };
}

function estimateFrameBytes(
  evaluation: Extract<MotionMediaFrameEvaluation, { status: 'ready' }>,
): number {
  const physicalWidth = Math.ceil(
    evaluation.renderParameters.targetWidth * evaluation.renderParameters.pixelRatio,
  );
  const physicalHeight = Math.ceil(
    evaluation.renderParameters.targetHeight * evaluation.renderParameters.pixelRatio,
  );
  return physicalWidth * physicalHeight * 4;
}

function createBudgetDiagnostic(
  code: 'FRAME_POOL_BUDGET_EXCEEDED' | 'DECODER_POOL_BUDGET_EXCEEDED',
  sourceId: string,
  message: string,
): MotionMediaDiagnostic {
  return { code, sourceId, message };
}
