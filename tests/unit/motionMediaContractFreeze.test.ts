import { describe, expect, it } from 'vitest';

import {
  createMotionMediaRequestFixture,
} from '../../src/services/motionDesign/media/contractFixtures';
import { assertMotionMediaInertJson } from '../../src/services/motionDesign/media/contractSafety';
import {
  MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES,
  MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES,
  MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES,
  MOTION_MEDIA_MAX_EVALUATIONS_PER_POOL_PLAN,
  MOTION_MEDIA_MAX_JSON_DEPTH,
  MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT,
  MOTION_MEDIA_TIME_SEMANTICS,
  type MotionMediaEvaluationRequest,
  type ReadyMotionMediaFrameEvaluation,
} from '../../src/services/motionDesign/media/contracts';
import {
  assertMotionMediaEvaluationRequest,
  assertMotionMediaFrameEvaluation,
  evaluateMotionMediaFrame,
  parseMotionMediaEvaluationRequest,
  parseMotionMediaFrameEvaluation,
  serializeMotionMediaEvaluationRequest,
  serializeMotionMediaFrameEvaluation,
} from '../../src/services/motionDesign/media/evaluationPlanner';
import {
  buildMotionMediaReuseKey,
  assertMotionMediaRenderParameters,
  assertMotionMediaResolvedTime,
} from '../../src/services/motionDesign/media/reuseKeyPlanner';
import {
  planMotionMediaResourcePools,
} from '../../src/services/motionDesign/media/resourcePoolPlanner';
import {
  createMotionMediaSourceReference,
  assertMotionMediaSourceBinding,
  assertMotionMediaSourceReference,
  markMotionMediaSourceMissing,
  relinkMotionMediaSource,
} from '../../src/services/motionDesign/media/sourceReferencePlanner';
import {
  assertMotionMediaTimingInputs,
  resolveMotionMediaSourceTime,
} from '../../src/services/motionDesign/media/timingPlanner';

describe('motion media contract freeze', () => {
  it('creates deterministic source identities for image, video, and nested comps', () => {
    const image = createMotionMediaSourceReference('image', 'media-image-1', null);
    const video = createMotionMediaSourceReference('video', 'media-video-1', 20);
    const nested = createMotionMediaSourceReference(
      'nested-composition',
      'composition-1',
      8,
    );

    expect(image.sourceId).toBe(
      'motion-media-source/v1:image:media-image-1',
    );
    expect(video.sourceId).toBe(
      'motion-media-source/v1:video:media-video-1',
    );
    expect(nested.sourceId).toBe(
      'motion-media-source/v1:nested-composition:composition-1',
    );
    expect(createMotionMediaSourceReference('video', 'media-video-1', 20))
      .toEqual(video);
  });

  it.each([
    '',
    'C:\\media\\clip.mp4',
    'C:relative',
    '/tmp/clip.mp4',
    'file:///tmp/clip.mp4',
    'file:opaque-looking-id',
    '.',
    '..',
    'asset/../clip',
    'asset\\..\\clip',
    'asset.id',
    'asset id',
    'asset\u0000id',
  ])('rejects path-like or non-allowlisted stable asset id %j', (stableAssetId) => {
    expect(() => createMotionMediaSourceReference(
      'video',
      stableAssetId,
      20,
    )).toThrowError('stable opaque asset id');
  });

  it('enforces the stable opaque asset-id length boundary', () => {
    expect(() => createMotionMediaSourceReference('video', 'a'.repeat(256), 20))
      .not.toThrow();
    expect(() => createMotionMediaSourceReference('video', 'a'.repeat(257), 20))
      .toThrowError('stable opaque asset id');
  });

  it('rejects non-inert JSON containers and runtime fields descriptor-safely', () => {
    let getterCalls = 0;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'contractVersion', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'motion-media-request/v1';
      },
    });
    expect(() => assertMotionMediaInertJson(accessor)).toThrowError(
      'accessors/non-data fields',
    );
    expect(getterCalls).toBe(0);

    const nonEnumerable = { value: 1 };
    Object.defineProperty(nonEnumerable, 'hidden', {
      enumerable: false,
      value: true,
    });
    expect(() => assertMotionMediaInertJson(nonEnumerable)).toThrowError(
      'accessors/non-data fields',
    );
    expect(() => assertMotionMediaInertJson({ [Symbol('hidden')]: true }))
      .toThrowError('symbol fields');
    expect(() => assertMotionMediaInertJson(new (class RuntimeObject {})()))
      .toThrowError('plain JSON containers');
    expect(() => assertMotionMediaInertJson(new Array(1)))
      .toThrowError('dense JSON arrays');
    expect(() => assertMotionMediaInertJson({ runtimeHandle: 'decoder-1' }))
      .toThrowError('runtime field is forbidden');
    expect(() => assertMotionMediaInertJson({ value: Number.POSITIVE_INFINITY }))
      .toThrowError('finite JSON numbers');
    expect(() => assertMotionMediaInertJson(
      nestedJsonArray(MOTION_MEDIA_MAX_JSON_DEPTH),
    )).not.toThrow();
    expect(() => assertMotionMediaInertJson(
      nestedJsonArray(MOTION_MEDIA_MAX_JSON_DEPTH + 1),
    )).toThrowError('JSON depth exceeds its hard budget');
  });

  it('runs every structured public assertion through getter-free preflight', () => {
    const request = createMotionMediaRequestFixture();
    expectGetterFreeBoundary(
      request,
      () => assertMotionMediaEvaluationRequest(request),
    );

    const bindingRequest = createMotionMediaRequestFixture();
    expectGetterFreeBoundary(
      bindingRequest.binding,
      () => assertMotionMediaSourceBinding(bindingRequest.binding),
    );

    const sourceRequest = createMotionMediaRequestFixture();
    expectGetterFreeBoundary(
      sourceRequest.binding.intent,
      () => assertMotionMediaSourceReference(sourceRequest.binding.intent),
    );

    const timingRequest = createMotionMediaRequestFixture();
    expectGetterFreeBoundary(
      timingRequest.timing,
      () => assertMotionMediaTimingInputs(
        timingRequest.binding.intent,
        timingRequest.timing,
        timingRequest.quantization,
        timingRequest.clipLocalTimeSeconds,
        timingRequest.instanceIndex,
      ),
    );

    const renderRequest = createMotionMediaRequestFixture();
    expectGetterFreeBoundary(
      renderRequest.renderParameters,
      () => assertMotionMediaRenderParameters(renderRequest.renderParameters),
    );

    const evaluation = ready(createMotionMediaRequestFixture());
    expectGetterFreeBoundary(
      evaluation.resolvedTime,
      () => assertMotionMediaResolvedTime(evaluation.resolvedTime),
    );

    const frameEvaluation = ready(createMotionMediaRequestFixture());
    expectGetterFreeBoundary(
      frameEvaluation,
      () => assertMotionMediaFrameEvaluation(frameEvaluation),
    );

    const relinkRequest = createMotionMediaRequestFixture();
    const replacement = {
      kind: relinkRequest.binding.intent.kind,
      sourceId: relinkRequest.binding.intent.sourceId,
      bindingRevision: 'binding-revision-2',
    };
    expectGetterFreeBoundary(
      replacement,
      () => relinkMotionMediaSource(relinkRequest.binding, replacement),
    );

    const poolInput = [ready(createMotionMediaRequestFixture())];
    expectGetterFreeBoundary(
      poolInput,
      () => planMotionMediaResourcePools(poolInput),
    );
  });

  it('round-trips request and evaluated contracts as runtime-handle-free JSON', () => {
    const request = createMotionMediaRequestFixture({ fitMode: 'tile' });
    request.renderParameters.tileRepeatX = 4;
    request.renderParameters.tileRepeatY = 3;
    const requestJson = serializeMotionMediaEvaluationRequest(request);
    const restoredRequest = parseMotionMediaEvaluationRequest(requestJson);
    const evaluation = evaluateMotionMediaFrame(restoredRequest);
    const evaluationJson = serializeMotionMediaFrameEvaluation(evaluation);

    expect(restoredRequest).toEqual(request);
    expect(parseMotionMediaFrameEvaluation(evaluationJson)).toEqual(evaluation);
    expect(`${requestJson}${evaluationJson}`).not.toMatch(
      /runtimeHandle|decoder|videoFrame|gpuTexture|canvas|localPath/,
    );
  });

  it('freezes forward, freeze, and reverse endpoint and negative-time semantics', () => {
    const request = createMotionMediaRequestFixture({ clipLocalTimeSeconds: 0 });
    request.timing.sourceInSeconds = 2;
    request.timing.sourceOutSeconds = 6;
    request.timing.freezeTimeSeconds = 3.25;

    request.timing.mode = 'forward';
    expect(resolveFor(request, -1)).toBe(2);
    expect(resolveFor(request, 4)).toBe(6);
    expect(resolveFor(request, 20)).toBe(6);

    request.timing.mode = 'freeze';
    expect(resolveFor(request, -100)).toBe(3.25);
    expect(resolveFor(request, 100)).toBe(3.25);

    request.timing.mode = 'reverse';
    expect(resolveFor(request, -1)).toBe(6);
    expect(resolveFor(request, 4)).toBe(2);
    expect(resolveFor(request, 20)).toBe(2);
    expect(MOTION_MEDIA_TIME_SEMANTICS.inputBasis).toBe('clip-local-seconds');
  });

  it('freezes loop and pingpong endpoint behavior with Euclidean negative time', () => {
    const request = createMotionMediaRequestFixture({ clipLocalTimeSeconds: 0 });
    request.timing.sourceInSeconds = 0;
    request.timing.sourceOutSeconds = 4;
    request.timing.freezeTimeSeconds = 0;

    request.timing.mode = 'loop';
    expect(resolveFor(request, 4)).toBe(0);
    expect(resolveFor(request, 5)).toBe(1);
    expect(resolveFor(request, -1)).toBe(3);

    request.timing.mode = 'pingpong';
    expect(resolveFor(request, 4)).toBe(4);
    expect(resolveFor(request, 5)).toBe(3);
    expect(resolveFor(request, 8)).toBe(0);
    expect(resolveFor(request, -1)).toBe(1);
  });

  it('applies deterministic zero-based per-instance offsets before timing mode', () => {
    const request = createMotionMediaRequestFixture({
      mode: 'loop',
      clipLocalTimeSeconds: 1,
      perInstanceOffsetSeconds: 0.5,
      instanceIndex: 3,
    });
    const first = ready(request);
    const second = ready(request);

    expect(first.resolvedTime.seconds).toBe(2.5);
    expect(second).toEqual(first);
  });

  it('quantizes resolved source time with explicit nearest-half-up ticks', () => {
    const belowHalf = createMotionMediaRequestFixture({
      clipLocalTimeSeconds: 0.00049,
      ticksPerSecond: 1_000,
    });
    const atHalf = createMotionMediaRequestFixture({
      clipLocalTimeSeconds: 0.0005,
      ticksPerSecond: 1_000,
    });

    expect(ready(belowHalf).resolvedTime).toEqual({
      ticks: 0,
      ticksPerSecond: 1_000,
      seconds: 0,
    });
    expect(ready(atHalf).resolvedTime).toEqual({
      ticks: 1,
      ticksPerSecond: 1_000,
      seconds: 0.001,
    });
  });

  it('keeps image source time fixed at zero for every clip-local time', () => {
    const request = createMotionMediaRequestFixture({
      kind: 'image',
      mode: 'pingpong',
      clipLocalTimeSeconds: -500,
      instanceIndex: 25,
      perInstanceOffsetSeconds: 10,
    });

    expect(ready(request).resolvedTime).toEqual({
      ticks: 0,
      ticksPerSecond: 1_000,
      seconds: 0,
    });
  });

  it('builds a stable reuse key from source id, quantized time, and render params', () => {
    const request = createMotionMediaRequestFixture();
    const evaluation = ready(request);
    const reorderedRenderParameters = {
      sampling: request.renderParameters.sampling,
      tileOffsetY: request.renderParameters.tileOffsetY,
      tileOffsetX: request.renderParameters.tileOffsetX,
      tileRepeatY: request.renderParameters.tileRepeatY,
      tileRepeatX: request.renderParameters.tileRepeatX,
      rotationDegrees: request.renderParameters.rotationDegrees,
      scaleY: request.renderParameters.scaleY,
      scaleX: request.renderParameters.scaleX,
      positionY: request.renderParameters.positionY,
      positionX: request.renderParameters.positionX,
      fitMode: request.renderParameters.fitMode,
      pixelRatio: request.renderParameters.pixelRatio,
      targetHeight: request.renderParameters.targetHeight,
      targetWidth: request.renderParameters.targetWidth,
    };

    expect(buildMotionMediaReuseKey(
      evaluation.sourceId,
      evaluation.resolvedTime,
      reorderedRenderParameters,
    )).toBe(evaluation.reuseKey);

    const later = ready({ ...request, clipLocalTimeSeconds: 2.5 });
    const filled = createMotionMediaRequestFixture({ fitMode: 'fill' });
    expect(later.reuseKey).not.toBe(evaluation.reuseKey);
    expect(ready(filled).reuseKey).not.toBe(evaluation.reuseKey);
    expect(() => buildMotionMediaReuseKey(
      'C:\\not-a-source-id.mp4',
      evaluation.resolvedTime,
      request.renderParameters,
    )).toThrowError('Invalid canonical motion media source id');
  });

  it('fails missing evaluation closed and relinks without changing source intent', () => {
    const original = createMotionMediaRequestFixture();
    const originalReady = ready(original);
    const missingBinding = markMotionMediaSourceMissing(
      original.binding,
      'not-found',
    );
    const missing = evaluateMotionMediaFrame({
      ...original,
      binding: missingBinding,
    });

    expect(missing).toMatchObject({
      status: 'unavailable',
      sourceId: original.binding.intent.sourceId,
      resolvedTime: null,
      reuseKey: null,
      diagnostics: [{
        code: 'SOURCE_MISSING',
        sourceId: original.binding.intent.sourceId,
      }],
    });
    expect(() => relinkMotionMediaSource(missingBinding, {
      kind: 'video',
      sourceId: `${original.binding.intent.sourceId}:replacement`,
      bindingRevision: 'binding-revision-2',
    })).toThrowError('Relink must preserve');
    expect(() => relinkMotionMediaSource(missingBinding, {
      kind: original.binding.intent.kind,
      sourceId: original.binding.intent.sourceId,
      bindingRevision: 'binding-revision-1',
    })).toThrowError('advance to a new binding revision');

    const relinkedBinding = relinkMotionMediaSource(missingBinding, {
      kind: original.binding.intent.kind,
      sourceId: original.binding.intent.sourceId,
      bindingRevision: 'binding-revision-2',
    });
    const relinked = ready({ ...original, binding: relinkedBinding });
    expect(relinked.sourceId).toBe(originalReady.sourceId);
    expect(relinked.reuseKey).toBe(originalReady.reuseKey);
    expect(originalReady.bindingRevision).toBe('binding-revision-1');
    expect(relinked.bindingRevision).toBe('binding-revision-2');
    expect(relinkedBinding.intent).toEqual(original.binding.intent);

    const mixedPool = planMotionMediaResourcePools([originalReady, relinked]);
    expect(mixedPool.requests.map((request) => ({
      bindingRevision: request.bindingRevision,
      reusesFrame: request.reusesFrame,
      reusesDecoder: request.reusesDecoder,
    }))).toEqual([
      {
        bindingRevision: 'binding-revision-1',
        reusesFrame: false,
        reusesDecoder: false,
      },
      {
        bindingRevision: 'binding-revision-2',
        reusesFrame: false,
        reusesDecoder: false,
      },
    ]);
    expect(mixedPool.framePool.admittedFrames).toHaveLength(2);
    expect(mixedPool.decoderPool.admittedDecoders).toHaveLength(2);
    expect(mixedPool.framePool.admittedFrames[0]?.identityKey).not.toBe(
      mixedPool.framePool.admittedFrames[1]?.identityKey,
    );
    expect(mixedPool.decoderPool.admittedDecoders[0]?.identityKey).not.toBe(
      mixedPool.decoderPool.admittedDecoders[1]?.identityKey,
    );

    expect(() => relinkMotionMediaSource(relinkedBinding, {
      kind: original.binding.intent.kind,
      sourceId: original.binding.intent.sourceId,
      bindingRevision: 'binding-revision-2',
    })).toThrowError('advance to a new binding revision');
    expect(() => relinkMotionMediaSource(relinkedBinding, {
      kind: original.binding.intent.kind,
      sourceId: original.binding.intent.sourceId,
      bindingRevision: 'binding-revision-1',
    })).toThrowError('advance to a new binding revision');

    const forgedNoOpRelink = structuredClone(relinkedBinding);
    if (forgedNoOpRelink.availability.state !== 'relinked') {
      throw new Error('Expected relinked binding fixture');
    }
    forgedNoOpRelink.availability.bindingRevision =
      forgedNoOpRelink.availability.relinkedFromRevision ?? '';
    expect(() => assertMotionMediaSourceBinding(forgedNoOpRelink))
      .toThrowError('must change revision');
    expect(() => parseMotionMediaEvaluationRequest(JSON.stringify({
      ...original,
      binding: forgedNoOpRelink,
    }))).toThrowError('must change revision');
    expect(JSON.parse(JSON.stringify(mixedPool))).toEqual(mixedPool);
  });

  it('carries an explicit last or null binding revision while unavailable', () => {
    const request = createMotionMediaRequestFixture();
    const missingWithLast = evaluateMotionMediaFrame({
      ...request,
      binding: markMotionMediaSourceMissing(request.binding, 'offline'),
    });
    const missingWithoutLast = evaluateMotionMediaFrame({
      ...request,
      binding: {
        intent: { ...request.binding.intent },
        availability: {
          state: 'missing',
          reason: 'not-found',
          lastBindingRevision: null,
        },
      },
    });

    expect(missingWithLast.bindingRevision).toBe('binding-revision-1');
    expect(missingWithoutLast.bindingRevision).toBeNull();
    const pool = planMotionMediaResourcePools([missingWithoutLast]);
    expect(pool.requests[0]).toMatchObject({
      status: 'unavailable',
      bindingRevision: null,
      frameIdentityKey: null,
      decoderIdentityKey: null,
    });
  });

  it.each(['fit', 'fill', 'stretch', 'tile'] as const)(
    'accepts and preserves %s render placement',
    (fitMode) => {
      const request = createMotionMediaRequestFixture({ fitMode });
      expect(ready(request).renderParameters.fitMode).toBe(fitMode);
    },
  );

  it('rejects malformed, extra-field, and non-finite request contracts', () => {
    const request = createMotionMediaRequestFixture();
    const malformed = JSON.parse(
      serializeMotionMediaEvaluationRequest(request),
    ) as Record<string, unknown>;
    delete (malformed.timing as Record<string, unknown>).mode;
    expect(() => parseMotionMediaEvaluationRequest(JSON.stringify(malformed)))
      .toThrow();

    const extraField = JSON.parse(
      serializeMotionMediaEvaluationRequest(request),
    ) as Record<string, unknown>;
    extraField.runtimeHandle = 'decoder-1';
    expect(() => parseMotionMediaEvaluationRequest(JSON.stringify(extraField)))
      .toThrow();

    request.clipLocalTimeSeconds = Number.POSITIVE_INFINITY;
    expect(() => assertMotionMediaEvaluationRequest(request)).toThrow();
    expect(() => serializeMotionMediaEvaluationRequest(request)).toThrow();
  });

  it('rejects invalid bounds, endpoints, quantization, and output reuse keys', () => {
    const oversized = createMotionMediaRequestFixture();
    oversized.renderParameters.targetWidth = 16_385;
    expect(() => evaluateMotionMediaFrame(oversized)).toThrow();

    const badEndpoint = createMotionMediaRequestFixture();
    badEndpoint.timing.sourceOutSeconds = 20;
    expect(() => evaluateMotionMediaFrame(badEndpoint)).toThrow();

    const badTimebase = createMotionMediaRequestFixture();
    badTimebase.quantization.ticksPerSecond = 0;
    expect(() => evaluateMotionMediaFrame(badTimebase)).toThrow();

    const evaluation = ready(createMotionMediaRequestFixture());
    const serialized = JSON.parse(
      serializeMotionMediaFrameEvaluation(evaluation),
    ) as Record<string, unknown>;
    serialized.reuseKey = 'tampered';
    expect(() => parseMotionMediaFrameEvaluation(JSON.stringify(serialized)))
      .toThrowError('Invalid ready motion media frame evaluation');
  });

  it('accepts stable index 99,999 but rejects 100,000 independently of pool size', () => {
    const maximum = createMotionMediaRequestFixture({
      instanceIndex: MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT - 1,
    });
    expect(ready(maximum).instanceIndex).toBe(99_999);

    const overflow = createMotionMediaRequestFixture({
      instanceIndex: MOTION_MEDIA_MAX_STABLE_INSTANCE_COUNT,
    });
    expect(() => evaluateMotionMediaFrame(overflow)).toThrowError(
      'instance index is out of bounds',
    );
  });

  it('rejects malformed binding revisions in requests and evaluations', () => {
    const request = createMotionMediaRequestFixture();
    if (request.binding.availability.state !== 'available') {
      throw new Error('Expected available binding fixture');
    }
    request.binding.availability.bindingRevision = '';
    expect(() => assertMotionMediaEvaluationRequest(request)).toThrowError(
      'binding revision',
    );

    const evaluation = ready(createMotionMediaRequestFixture());
    const malformed = JSON.parse(
      serializeMotionMediaFrameEvaluation(evaluation),
    ) as Record<string, unknown>;
    malformed.bindingRevision = 42;
    expect(() => parseMotionMediaFrameEvaluation(JSON.stringify(malformed)))
      .toThrowError('binding revision');
  });

  it('reuses one frame and decoder for equal video requests', () => {
    const evaluation = ready(createMotionMediaRequestFixture());
    const plan = planMotionMediaResourcePools([evaluation, evaluation]);

    expect(plan.framePool).toMatchObject({
      hardLimit: MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES,
      uniqueIdentitiesRequested: 1,
    });
    expect(plan.decoderPool).toMatchObject({
      hardLimit: MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES,
      uniqueBindingsRequested: 1,
    });
    expect(plan.requests.map((request) => ({
      status: request.status,
      reusesFrame: request.reusesFrame,
      reusesDecoder: request.reusesDecoder,
    }))).toEqual([
      { status: 'admitted', reusesFrame: false, reusesDecoder: false },
      { status: 'admitted', reusesFrame: true, reusesDecoder: true },
    ]);
  });

  it('enforces the named decoder-pool hard budget deterministically', () => {
    const evaluations = Array.from(
      { length: MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES + 1 },
      (_, index) => ready(createMotionMediaRequestFixture({
        stableAssetId: `video-source-${index}`,
      })),
    );
    const first = planMotionMediaResourcePools(evaluations);
    const second = planMotionMediaResourcePools(evaluations);

    expect(second).toEqual(first);
    expect(first.decoderPool.admittedDecoders).toHaveLength(
      MOTION_MEDIA_DECODER_POOL_MAX_UNIQUE_VIDEO_SOURCES,
    );
    expect(first.requests.at(-1)).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'DECODER_POOL_BUDGET_EXCEEDED' }],
    });
  });

  it('enforces the named unique-frame hard budget without decoder-per-instance', () => {
    const requests = Array.from(
      { length: MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES + 1 },
      (_, instanceIndex) => createMotionMediaRequestFixture({
        clipLocalTimeSeconds: 0,
        instanceIndex,
        perInstanceOffsetSeconds: 0.001,
        ticksPerSecond: 1_000,
      }),
    );
    for (const request of requests) {
      request.renderParameters.targetWidth = 16;
      request.renderParameters.targetHeight = 16;
    }
    const plan = planMotionMediaResourcePools(requests.map(ready));

    expect(plan.framePool.uniqueIdentitiesRequested).toBe(
      MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES + 1,
    );
    expect(plan.framePool.admittedFrames).toHaveLength(
      MOTION_MEDIA_FRAME_POOL_MAX_UNIQUE_FRAMES,
    );
    expect(plan.decoderPool.admittedDecoders).toHaveLength(1);
    expect(plan.requests.at(-1)).toMatchObject({
      status: 'rejected',
      diagnostics: [{ code: 'FRAME_POOL_BUDGET_EXCEEDED' }],
    });
  });

  it('enforces the named estimated frame-pool byte budget', () => {
    const first = createMotionMediaRequestFixture({ clipLocalTimeSeconds: 1 });
    const second = createMotionMediaRequestFixture({ clipLocalTimeSeconds: 2 });
    const third = createMotionMediaRequestFixture({ clipLocalTimeSeconds: 3 });
    for (const request of [first, second, third]) {
      request.renderParameters.targetWidth = 8_192;
      request.renderParameters.targetHeight = 8_192;
    }

    const plan = planMotionMediaResourcePools([
      ready(first),
      ready(second),
      ready(third),
    ]);
    expect(plan.framePool.hardEstimatedByteLimit).toBe(
      MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES,
    );
    expect(plan.framePool.admittedEstimatedBytes).toBe(
      MOTION_MEDIA_FRAME_POOL_MAX_ESTIMATED_BYTES,
    );
    expect(plan.requests).toMatchObject([
      { status: 'admitted' },
      { status: 'admitted' },
      {
        status: 'rejected',
        diagnostics: [{ code: 'FRAME_POOL_BUDGET_EXCEEDED' }],
      },
    ]);
  });

  it('fails closed above the maximum pool-plan request count', () => {
    const evaluation = ready(createMotionMediaRequestFixture());
    const tooMany = Array.from(
      { length: MOTION_MEDIA_MAX_EVALUATIONS_PER_POOL_PLAN + 1 },
      () => evaluation,
    );
    expect(() => planMotionMediaResourcePools(tooMany)).toThrowError(
      'request count exceeds its hard budget',
    );
  });
});

function resolveFor(
  request: MotionMediaEvaluationRequest,
  clipLocalTimeSeconds: number,
): number {
  return resolveMotionMediaSourceTime(
    request.binding.intent,
    request.timing,
    request.quantization,
    clipLocalTimeSeconds,
    request.instanceIndex,
  ).seconds;
}

function ready(
  request: MotionMediaEvaluationRequest,
): ReadyMotionMediaFrameEvaluation {
  const evaluation = evaluateMotionMediaFrame(request);
  if (evaluation.status !== 'ready') {
    throw new Error('Expected ready motion media fixture');
  }
  return evaluation;
}

function expectGetterFreeBoundary(
  candidate: object,
  assertBoundary: () => void,
): void {
  let getterCalls = 0;
  const key = Array.isArray(candidate) ? '0' : Reflect.ownKeys(candidate)[0];
  if (key === undefined) throw new Error('Expected a candidate field');
  Object.defineProperty(candidate, key, {
    configurable: true,
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return undefined;
    },
  });
  expect(assertBoundary).toThrowError('accessors/non-data fields');
  expect(getterCalls).toBe(0);
}

function nestedJsonArray(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}
