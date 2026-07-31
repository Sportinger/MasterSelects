import { useMediaStore } from '../../../../../stores/mediaStore';
import type { Sample } from '../../../../../engine/webCodecsTypes';
import { loadProxyVideoWithMP4Box } from '../../../../proxyGeneration/mp4Demuxer';
import { createCompositorPipelineResources } from '../../../../../engine/pipeline/compositor/pipelineResources';
import { COMPOSITOR_UNIFORM_SIZE } from '../../../../../engine/pipeline/compositor/uniforms';
import { WebCodecsPlayer } from '../../../../../engine/WebCodecsPlayer';
import { OutputPipeline } from '../../../../../engine/pipeline/OutputPipeline';
import { renderHostPort } from '../../../../render/renderHostPort';

type ProbeOperation =
  | 'none'
  | 'copy-native'
  | 'copy-rgba'
  | 'image-bitmap'
  | 'webgpu'
  | 'external-texture'
  | 'external-composite';
type HardwarePreference = 'prefer-hardware' | 'prefer-software' | 'no-preference';
type ProbeOutputSink = 'texture' | 'offscreen-canvas';
type ProbeCanvasConsumer = 'none' | 'capture' | 'encode';

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function closestSampleIndex(samples: Sample[], targetSeconds: number): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const distance = Math.abs((sample.cts / sample.timescale) - targetSeconds);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex;
}

function previousKeyframeIndex(samples: Sample[], startIndex: number): number {
  let index = Math.max(0, Math.min(samples.length - 1, startIndex));
  while (index > 0 && !samples[index].is_sync) index -= 1;
  return index;
}

function sampleTimestampUs(sample: Sample): number {
  return Math.round((sample.cts * 1_000_000) / sample.timescale);
}

function frameColorSpace(frame: VideoFrame): Record<string, unknown> | null {
  try {
    return frame.colorSpace.toJSON() as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface ExternalCompositeRunner {
  render(frame: VideoFrame): Promise<Record<string, unknown>>;
  createVideoFrame(timestamp: number, duration: number): VideoFrame | null;
}

const externalCompositeRunnerCache = new WeakMap<
  GPUDevice,
  Map<string, ExternalCompositeRunner>
>();

function getExternalCompositeRunner(
  gpuDevice: GPUDevice,
  outputWidth: number,
  outputHeight: number,
  outputSink: ProbeOutputSink = 'texture',
): ExternalCompositeRunner {
  let deviceRunners = externalCompositeRunnerCache.get(gpuDevice);
  if (!deviceRunners) {
    deviceRunners = new Map();
    externalCompositeRunnerCache.set(gpuDevice, deviceRunners);
  }
  const cacheKey = `${outputWidth}x${outputHeight}:${outputSink}`;
  const cached = deviceRunners.get(cacheKey);
  if (cached) return cached;

  const resources = createCompositorPipelineResources(gpuDevice);
  const baseTexture = gpuDevice.createTexture({
    size: [outputWidth, outputHeight],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const maskTexture = gpuDevice.createTexture({
    size: [1, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  gpuDevice.queue.writeTexture(
    { texture: maskTexture },
    new Uint8Array([255, 255, 255, 255]),
    { bytesPerRow: 4 },
    [1, 1],
  );
  const compositeTarget = gpuDevice.createTexture({
    size: [outputWidth, outputHeight],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const outputTarget = outputSink === 'texture'
    ? gpuDevice.createTexture({
        size: [outputWidth, outputHeight],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    : null;
  const uniformBuffer = gpuDevice.createBuffer({
    size: COMPOSITOR_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformBytes = new ArrayBuffer(COMPOSITOR_UNIFORM_SIZE);
  const uniformFloats = new Float32Array(uniformBytes);
  const uniformU32 = new Uint32Array(uniformBytes);
  uniformFloats[0] = 1;
  uniformU32[1] = 0;
  uniformFloats[4] = 1;
  uniformFloats[5] = 1;
  uniformFloats[7] = outputWidth / outputHeight;
  uniformFloats[8] = outputWidth / outputHeight;
  uniformFloats[14] = 2;
  uniformFloats[19] = 1;
  uniformFloats[20] = 1;
  uniformFloats[27] = 1;
  uniformFloats[28] = 1;
  gpuDevice.queue.writeBuffer(uniformBuffer, 0, uniformBytes);
  const sampler = gpuDevice.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const outputBindGroup = outputTarget
    ? gpuDevice.createBindGroup({
        layout: resources.copyBindGroupLayout,
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: compositeTarget.createView() },
        ],
      })
    : null;
  const outputCanvas = outputSink === 'offscreen-canvas'
    ? new OffscreenCanvas(outputWidth, outputHeight)
    : null;
  const outputCanvasContext = outputCanvas?.getContext('webgpu') ?? null;
  if (outputCanvasContext) {
    outputCanvasContext.configure({
      device: gpuDevice,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });
  }
  const canvasOutputPipeline = outputCanvasContext
    ? new OutputPipeline(gpuDevice)
    : null;
  const canvasOutputReady = canvasOutputPipeline?.createPipeline() ?? Promise.resolve();
  const runner: ExternalCompositeRunner = {
    async render(frame) {
      await canvasOutputReady;
      const submitStartedAt = performance.now();
      const externalTexture = gpuDevice.importExternalTexture({ source: frame });
      const compositeBindGroup = gpuDevice.createBindGroup({
        layout: resources.externalCompositeBindGroupLayout,
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: baseTexture.createView() },
          { binding: 2, resource: externalTexture },
          { binding: 3, resource: { buffer: uniformBuffer } },
          { binding: 4, resource: maskTexture.createView() },
        ],
      });
      const encoder = gpuDevice.createCommandEncoder();
      const compositePass = encoder.beginRenderPass({
        colorAttachments: [{
          view: compositeTarget.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      compositePass.setPipeline(resources.externalCompositePipeline);
      compositePass.setBindGroup(0, compositeBindGroup);
      compositePass.draw(6);
      compositePass.end();
      if (outputTarget && outputBindGroup) {
        const outputPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: outputTarget.createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          }],
        });
        outputPass.setPipeline(resources.copyPipeline);
        outputPass.setBindGroup(0, outputBindGroup);
        outputPass.draw(6);
        outputPass.end();
      } else if (outputCanvasContext && canvasOutputPipeline) {
        canvasOutputPipeline.updateResolution(outputWidth, outputHeight);
        const canvasBindGroup = canvasOutputPipeline.createOutputBindGroup(
          sampler,
          compositeTarget.createView(),
          'normal',
        );
        canvasOutputPipeline.renderToCanvas(encoder, outputCanvasContext, canvasBindGroup);
      }
      gpuDevice.queue.submit([encoder.finish()]);
      const submitMs = performance.now() - submitStartedAt;
      const completionStartedAt = performance.now();
      await gpuDevice.queue.onSubmittedWorkDone();
      const completionMs = performance.now() - completionStartedAt;
      return {
        outputSink,
        submitMs: round(submitMs),
        operationMs: round(submitMs + completionMs),
        queueCompletionMs: round(completionMs),
      };
    },
    createVideoFrame(timestamp, duration) {
      if (!outputCanvas) return null;
      return new VideoFrame(outputCanvas, {
        timestamp,
        duration,
        alpha: 'discard',
      });
    },
  };
  deviceRunners.set(cacheKey, runner);
  return runner;
}

async function runFrameOperation(
  frame: VideoFrame,
  operation: ProbeOperation,
  gpuDevice: GPUDevice | null,
  outputWidth: number,
  outputHeight: number,
): Promise<Record<string, unknown>> {
  if (operation === 'none') return {};

  if (operation === 'copy-native') {
    const allocationSize = frame.allocationSize();
    const target = new Uint8Array(allocationSize);
    const startedAt = performance.now();
    const layout = await frame.copyTo(target);
    return {
      operationMs: round(performance.now() - startedAt),
      allocationSize,
      planeCount: layout.length,
    };
  }

  if (operation === 'copy-rgba') {
    const allocationSize = frame.allocationSize({ format: 'RGBA' });
    const target = new Uint8Array(allocationSize);
    const startedAt = performance.now();
    const layout = await frame.copyTo(target, { format: 'RGBA' });
    return {
      operationMs: round(performance.now() - startedAt),
      allocationSize,
      planeCount: layout.length,
    };
  }

  if (operation === 'image-bitmap') {
    const startedAt = performance.now();
    const bitmap = await createImageBitmap(frame);
    const operationMs = performance.now() - startedAt;
    bitmap.close();
    return { operationMs: round(operationMs) };
  }

  if (!gpuDevice) {
    throw new Error('WebGPU device unavailable');
  }

  if (operation === 'external-texture') {
    const pipeline = await gpuDevice.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module: gpuDevice.createShaderModule({
          code: `
            struct VertexOutput {
              @builtin(position) position: vec4f,
              @location(0) uv: vec2f,
            }

            @vertex
            fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
              var positions = array<vec2f, 3>(
                vec2f(-1.0, -1.0),
                vec2f(3.0, -1.0),
                vec2f(-1.0, 3.0)
              );
              var uvs = array<vec2f, 3>(
                vec2f(0.0, 1.0),
                vec2f(2.0, 1.0),
                vec2f(0.0, -1.0)
              );
              var output: VertexOutput;
              output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
              output.uv = uvs[vertexIndex];
              return output;
            }
          `,
        }),
        entryPoint: 'main',
      },
      fragment: {
        module: gpuDevice.createShaderModule({
          code: `
            @group(0) @binding(0) var videoFrame: texture_external;
            @group(0) @binding(1) var videoSampler: sampler;

            @fragment
            fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
              return textureSampleBaseClampToEdge(videoFrame, videoSampler, uv);
            }
          `,
        }),
        entryPoint: 'main',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const target = gpuDevice.createTexture({
      size: {
        width: outputWidth,
        height: outputHeight,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const sampler = gpuDevice.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
    const submitStartedAt = performance.now();
    const externalTexture = gpuDevice.importExternalTexture({ source: frame });
    const bindGroup = gpuDevice.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: externalTexture },
        { binding: 1, resource: sampler },
      ],
    });
    const encoder = gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    gpuDevice.queue.submit([encoder.finish()]);
    const submitMs = performance.now() - submitStartedAt;
    const completionStartedAt = performance.now();
    await gpuDevice.queue.onSubmittedWorkDone();
    const completionMs = performance.now() - completionStartedAt;
    target.destroy();
    return {
      submitMs: round(submitMs),
      operationMs: round(submitMs + completionMs),
      queueCompletionMs: round(completionMs),
    };
  }

  if (operation === 'external-composite') {
    return getExternalCompositeRunner(
      gpuDevice,
      outputWidth,
      outputHeight,
    ).render(frame);
  }

  const texture = gpuDevice.createTexture({
    size: {
      width: frame.codedWidth,
      height: frame.codedHeight,
      depthOrArrayLayers: 1,
    },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  const submitStartedAt = performance.now();
  gpuDevice.queue.copyExternalImageToTexture(
    { source: frame },
    { texture },
    {
      width: frame.codedWidth,
      height: frame.codedHeight,
      depthOrArrayLayers: 1,
    },
  );
  const submitMs = performance.now() - submitStartedAt;
  const completionStartedAt = performance.now();
  await gpuDevice.queue.onSubmittedWorkDone();
  const completionMs = performance.now() - completionStartedAt;
  texture.destroy();
  return {
    submitMs: round(submitMs),
    operationMs: round(submitMs + completionMs),
    queueCompletionMs: round(completionMs),
  };
}

interface TargetProbeOptions {
  samples: Sample[];
  codecConfig: VideoDecoderConfig;
  centerSeconds: number;
  operation: ProbeOperation;
  hardwareAcceleration: HardwarePreference;
  flushBeforeOperation: boolean;
  gpuDevice: GPUDevice | null;
  outputWidth: number;
  outputHeight: number;
}

async function runTargetProbe(options: TargetProbeOptions): Promise<Record<string, unknown>> {
  const {
    samples,
    codecConfig,
    centerSeconds,
    operation,
    hardwareAcceleration,
    flushBeforeOperation,
    gpuDevice,
    outputWidth,
    outputHeight,
  } = options;
  const targetIndex = closestSampleIndex(samples, centerSeconds);
  const targetSample = samples[targetIndex];
  const targetTimestampUs = sampleTimestampUs(targetSample);
  const keyframeIndex = previousKeyframeIndex(samples, targetIndex);
  const decodeEndIndex = Math.min(samples.length, targetIndex + 6);
  const startedAt = performance.now();
  let firstOutputAt: number | null = null;
  let outputCount = 0;
  let decoderError: Error | null = null;
  let resolveTarget: ((value: { frame: VideoFrame; callbackAt: number }) => void) | null = null;
  let rejectTarget: ((reason: Error) => void) | null = null;
  const targetFramePromise = new Promise<{ frame: VideoFrame; callbackAt: number }>((resolve, reject) => {
    resolveTarget = resolve;
    rejectTarget = reject;
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      const callbackAt = performance.now();
      firstOutputAt ??= callbackAt;
      outputCount += 1;
      if (frame.timestamp === targetTimestampUs && resolveTarget) {
        const resolve = resolveTarget;
        resolveTarget = null;
        rejectTarget = null;
        resolve({ frame, callbackAt });
        return;
      }
      frame.close();
    },
    error: (error) => {
      decoderError = error;
      rejectTarget?.(error);
      resolveTarget = null;
      rejectTarget = null;
    },
  });

  try {
    decoder.configure({
      ...codecConfig,
      hardwareAcceleration,
    });
    for (let index = keyframeIndex; index < decodeEndIndex; index += 1) {
      let backpressurePolls = 0;
      while (decoder.decodeQueueSize >= 2 && backpressurePolls < 5000) {
        if (decoderError) throw decoderError;
        await delay(1);
        backpressurePolls += 1;
      }
      const sample = samples[index];
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: sampleTimestampUs(sample),
        duration: Math.round((sample.duration * 1_000_000) / sample.timescale),
        data: sample.data,
      }));
    }

    const timeoutPromise = delay(8000).then(() => {
      throw new Error(`Timed out waiting for target frame at ${centerSeconds.toFixed(3)}s`);
    });
    const target = await Promise.race([targetFramePromise, timeoutPromise]);
    const callbackLatencyMs = target.callbackAt - startedAt;
    let flushMs = 0;
    if (flushBeforeOperation) {
      const flushStartedAt = performance.now();
      await decoder.flush();
      flushMs = performance.now() - flushStartedAt;
    }
    const operationResult = await runFrameOperation(
      target.frame,
      operation,
      gpuDevice,
      outputWidth,
      outputHeight,
    );
    const frameMetadata = {
      format: target.frame.format,
      codedWidth: target.frame.codedWidth,
      codedHeight: target.frame.codedHeight,
      displayWidth: target.frame.displayWidth,
      displayHeight: target.frame.displayHeight,
      colorSpace: frameColorSpace(target.frame),
    };
    target.frame.close();

    return {
      success: true,
      centerSeconds,
      targetSeconds: round(targetSample.cts / targetSample.timescale),
      operation,
      hardwareAcceleration,
      flushBeforeOperation,
      targetIndex,
      keyframeIndex,
      framesFromKeyframe: targetIndex - keyframeIndex,
      samplesFed: decodeEndIndex - keyframeIndex,
      firstOutputLatencyMs: firstOutputAt === null ? null : round(firstOutputAt - startedAt),
      callbackLatencyMs: round(callbackLatencyMs),
      flushMs: round(flushMs),
      outputCountAtTarget: outputCount,
      frame: frameMetadata,
      ...operationResult,
    };
  } catch (error) {
    return {
      success: false,
      centerSeconds,
      operation,
      hardwareAcceleration,
      flushBeforeOperation,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try { decoder.close(); } catch {}
  }
}

interface SequenceProbeOptions {
  samples: Sample[];
  codecConfig: VideoDecoderConfig;
  centerSeconds: number;
  frameCount: number;
  hardwareAcceleration: HardwarePreference;
  gpuDevice: GPUDevice;
  outputWidth: number;
  outputHeight: number;
}

interface PlayerSequenceProbeOptions {
  sourceBuffer: ArrayBuffer;
  samples: Sample[];
  centerSeconds: number;
  frameCount: number;
  gpuDevice: GPUDevice;
  outputWidth: number;
  outputHeight: number;
  outputSink: ProbeOutputSink;
  canvasConsumer: ProbeCanvasConsumer;
  fps: number;
  bitrate: number;
}

async function runPlayerSequenceProbe(
  options: PlayerSequenceProbeOptions,
): Promise<Record<string, unknown>> {
  const {
    sourceBuffer,
    samples,
    centerSeconds,
    frameCount,
    gpuDevice,
    outputWidth,
    outputHeight,
    outputSink,
    canvasConsumer,
    fps,
    bitrate,
  } = options;
  const presentationOrder = samples
    .map((sample) => ({
      sample,
      sourceTimeSeconds: sample.cts / sample.timescale,
    }))
    .sort((left, right) => left.sample.cts - right.sample.cts);
  let firstPresentationIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < presentationOrder.length; index += 1) {
    const distance = Math.abs(presentationOrder[index].sourceTimeSeconds - centerSeconds);
    if (distance < closestDistance) {
      closestDistance = distance;
      firstPresentationIndex = index;
    }
  }
  const targets = presentationOrder.slice(
    firstPresentationIndex,
    Math.min(presentationOrder.length, firstPresentationIndex + frameCount),
  );
  if (targets.length === 0) {
    return { success: false, implementation: 'WebCodecsPlayer', error: 'No target samples available' };
  }

  const player = new WebCodecsPlayer({
    useSimpleMode: false,
    loop: false,
    hardwareAcceleration: 'prefer-hardware',
  });
  const runner = getExternalCompositeRunner(gpuDevice, outputWidth, outputHeight, outputSink);
  const perFrame: Array<Record<string, unknown>> = [];
  const startedAt = performance.now();
  let encodedChunkCount = 0;
  let encoderError: Error | null = null;
  const encoder = canvasConsumer === 'encode'
    ? new VideoEncoder({
        output: () => {
          encodedChunkCount += 1;
        },
        error: (error) => {
          encoderError = error;
        },
      })
    : null;

  try {
    if (encoder) {
      const encoderConfig: VideoEncoderConfig = {
        codec: 'avc1.4d0028',
        width: outputWidth,
        height: outputHeight,
        bitrate,
        framerate: fps,
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-hardware',
        bitrateMode: 'variable',
        contentHint: 'motion',
      };
      const support = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!support.supported) {
        throw new Error('Probe VideoEncoder configuration is unsupported');
      }
      encoder.configure(encoderConfig);
    }
    const loadStartedAt = performance.now();
    await player.loadArrayBuffer(sourceBuffer);
    const loadMs = performance.now() - loadStartedAt;
    const prepareStartedAt = performance.now();
    await player.prepareForSequentialExport(targets[0].sourceTimeSeconds);
    const prepareMs = performance.now() - prepareStartedAt;

    for (let frameIndex = 0; frameIndex < targets.length; frameIndex += 1) {
      const target = targets[frameIndex];
      const seekStartedAt = performance.now();
      await player.seekDuringExport(target.sourceTimeSeconds);
      const seekMs = performance.now() - seekStartedAt;
      const frame = player.getCurrentFrame();
      if (!frame) {
        throw new Error(`WebCodecsPlayer returned no frame at ${target.sourceTimeSeconds.toFixed(3)}s`);
      }
      const operationResult = await runner.render(frame);
      let captureMs = 0;
      let encodeEnqueueMs = 0;
      let encodeFlushMs = 0;
      let encodeQueueSize: number | null = null;
      if (canvasConsumer !== 'none') {
        const captureStartedAt = performance.now();
        const capturedFrame = runner.createVideoFrame(
          Math.round(frameIndex * (1_000_000 / fps)),
          Math.round(1_000_000 / fps),
        );
        captureMs = performance.now() - captureStartedAt;
        if (!capturedFrame) {
          throw new Error(`Canvas capture unavailable for output sink "${outputSink}"`);
        }
        try {
          if (encoder) {
            if (encoderError) throw encoderError;
            if (encoder.encodeQueueSize >= 4) {
              const flushStartedAt = performance.now();
              await encoder.flush();
              encodeFlushMs = performance.now() - flushStartedAt;
            }
            const encodeStartedAt = performance.now();
            encoder.encode(capturedFrame, { keyFrame: frameIndex === 0 });
            encodeEnqueueMs = performance.now() - encodeStartedAt;
            encodeQueueSize = encoder.encodeQueueSize;
          }
        } finally {
          capturedFrame.close();
        }
      }
      perFrame.push({
        frameIndex,
        sourceTimeSeconds: round(target.sourceTimeSeconds),
        actualFrameTimeSeconds: round(frame.timestamp / 1_000_000),
        seekMs: round(seekMs),
        frameFormat: frame.format,
        canvasConsumer,
        captureMs: round(captureMs),
        encodeEnqueueMs: round(encodeEnqueueMs),
        encodeFlushMs: round(encodeFlushMs),
        encodeQueueSize,
        ...operationResult,
      });
    }

    let finalEncodeFlushMs = 0;
    if (encoder) {
      const flushStartedAt = performance.now();
      await encoder.flush();
      finalEncodeFlushMs = performance.now() - flushStartedAt;
      if (encoderError) throw encoderError;
    }
    const operationTimes = perFrame
      .map((entry) => typeof entry.operationMs === 'number' ? entry.operationMs : 0);
    const seekTimes = perFrame
      .map((entry) => typeof entry.seekMs === 'number' ? entry.seekMs : 0);
    return {
      success: true,
      implementation: 'WebCodecsPlayer',
      outputSink,
      canvasConsumer,
      centerSeconds,
      frameCount: perFrame.length,
      loadMs: round(loadMs),
      prepareMs: round(prepareMs),
      elapsedMs: round(performance.now() - startedAt),
      operationAverageMs: round(
        operationTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, operationTimes.length),
      ),
      operationMaxMs: round(Math.max(0, ...operationTimes)),
      seekAverageMs: round(
        seekTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, seekTimes.length),
      ),
      seekMaxMs: round(Math.max(0, ...seekTimes)),
      encodedChunkCount,
      finalEncodeFlushMs: round(finalEncodeFlushMs),
      playerDebugInfo: player.getDebugInfo(),
      perFrame,
    };
  } catch (error) {
    return {
      success: false,
      implementation: 'WebCodecsPlayer',
      outputSink,
      canvasConsumer,
      centerSeconds,
      elapsedMs: round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      perFrame,
    };
  } finally {
    try { encoder?.close(); } catch {}
    try { player.endSequentialExport(); } catch {}
    try { player.destroy(); } catch {}
  }
}

async function runSequenceProbe(options: SequenceProbeOptions): Promise<Record<string, unknown>> {
  const {
    samples,
    codecConfig,
    centerSeconds,
    frameCount,
    hardwareAcceleration,
    gpuDevice,
    outputWidth,
    outputHeight,
  } = options;
  const presentationOrder = samples
    .map((sample, decodeIndex) => ({ sample, decodeIndex }))
    .sort((left, right) => left.sample.cts - right.sample.cts);
  let firstPresentationIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < presentationOrder.length; index += 1) {
    const entry = presentationOrder[index];
    const distance = Math.abs((entry.sample.cts / entry.sample.timescale) - centerSeconds);
    if (distance < closestDistance) {
      closestDistance = distance;
      firstPresentationIndex = index;
    }
  }
  const targets = presentationOrder.slice(
    firstPresentationIndex,
    Math.min(presentationOrder.length, firstPresentationIndex + frameCount),
  );
  if (targets.length === 0) {
    return { success: false, centerSeconds, error: 'No target samples available' };
  }

  const firstDecodeIndex = Math.min(...targets.map((entry) => entry.decodeIndex));
  const keyframeIndex = previousKeyframeIndex(samples, firstDecodeIndex);
  const targetTimestamps = new Set(targets.map((entry) => sampleTimestampUs(entry.sample)));
  const frameBuffer = new Map<number, VideoFrame>();
  const frameWaiters = new Map<number, (frame: VideoFrame) => void>();
  let decoderError: Error | null = null;
  let decodeCursor = keyframeIndex;
  const startedAt = performance.now();
  const runner = getExternalCompositeRunner(gpuDevice, outputWidth, outputHeight);
  const perFrame: Array<Record<string, unknown>> = [];

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (!targetTimestamps.has(frame.timestamp)) {
        frame.close();
        return;
      }
      const waiter = frameWaiters.get(frame.timestamp);
      if (waiter) {
        frameWaiters.delete(frame.timestamp);
        waiter(frame);
        return;
      }
      const existing = frameBuffer.get(frame.timestamp);
      existing?.close();
      frameBuffer.set(frame.timestamp, frame);
    },
    error: (error) => {
      decoderError = error;
    },
  });

  async function feedUntil(endIndexExclusive: number): Promise<void> {
    const clampedEnd = Math.min(samples.length, endIndexExclusive);
    while (decodeCursor < clampedEnd) {
      let backpressurePolls = 0;
      while (decoder.decodeQueueSize >= 2 && backpressurePolls < 5000) {
        if (decoderError) throw decoderError;
        await delay(1);
        backpressurePolls += 1;
      }
      const sample = samples[decodeCursor];
      decoder.decode(new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: sampleTimestampUs(sample),
        duration: Math.round((sample.duration * 1_000_000) / sample.timescale),
        data: sample.data,
      }));
      decodeCursor += 1;
    }
  }

  async function waitForFrame(timestamp: number): Promise<VideoFrame> {
    const buffered = frameBuffer.get(timestamp);
    if (buffered) {
      frameBuffer.delete(timestamp);
      return buffered;
    }
    return Promise.race([
      new Promise<VideoFrame>((resolve) => {
        frameWaiters.set(timestamp, resolve);
      }),
      delay(8000).then(() => {
        throw new Error(`Timed out waiting for sequence frame ${timestamp}`);
      }),
    ]);
  }

  try {
    decoder.configure({
      ...codecConfig,
      hardwareAcceleration,
    });

    for (let frameIndex = 0; frameIndex < targets.length; frameIndex += 1) {
      const target = targets[frameIndex];
      const timestamp = sampleTimestampUs(target.sample);
      const decodeStartedAt = performance.now();
      await feedUntil(target.decodeIndex + 6);
      const frame = await waitForFrame(timestamp);
      const decodeWaitMs = performance.now() - decodeStartedAt;
      const operationResult = await runner.render(frame);
      const metadata = frameIndex === 0
        ? {
            format: frame.format,
            codedWidth: frame.codedWidth,
            codedHeight: frame.codedHeight,
            displayWidth: frame.displayWidth,
            displayHeight: frame.displayHeight,
            colorSpace: frameColorSpace(frame),
          }
        : undefined;
      frame.close();
      perFrame.push({
        frameIndex,
        sourceTimeSeconds: round(target.sample.cts / target.sample.timescale),
        decodeIndex: target.decodeIndex,
        decodeWaitMs: round(decodeWaitMs),
        ...(metadata ? { frame: metadata } : {}),
        ...operationResult,
      });
    }

    const operationTimes = perFrame
      .map((entry) => typeof entry.operationMs === 'number' ? entry.operationMs : 0);
    const decodeTimes = perFrame
      .map((entry) => typeof entry.decodeWaitMs === 'number' ? entry.decodeWaitMs : 0);
    return {
      success: true,
      centerSeconds,
      hardwareAcceleration,
      frameCount: perFrame.length,
      keyframeIndex,
      framesFromKeyframe: firstDecodeIndex - keyframeIndex,
      elapsedMs: round(performance.now() - startedAt),
      operationAverageMs: round(
        operationTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, operationTimes.length),
      ),
      operationMaxMs: round(Math.max(0, ...operationTimes)),
      decodeWaitAverageMs: round(
        decodeTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, decodeTimes.length),
      ),
      decodeWaitMaxMs: round(Math.max(0, ...decodeTimes)),
      perFrame,
    };
  } catch (error) {
    return {
      success: false,
      centerSeconds,
      hardwareAcceleration,
      elapsedMs: round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      perFrame,
    };
  } finally {
    for (const frame of frameBuffer.values()) frame.close();
    frameBuffer.clear();
    frameWaiters.clear();
    try { decoder.close(); } catch {}
  }
}

async function readGpuContext(mode: 'fresh' | 'engine'): Promise<{
  device: GPUDevice | null;
  adapterInfo: Record<string, unknown> | null;
  owned: boolean;
}> {
  if (mode === 'engine') {
    return {
      device: renderHostPort.getDevice(),
      adapterInfo: { source: 'masterselects-engine-device' },
      owned: false,
    };
  }
  if (!navigator.gpu) return { device: null, adapterInfo: null, owned: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { device: null, adapterInfo: null, owned: false };
  const info = adapter.info;
  const device = await adapter.requestDevice();
  return {
    device,
    adapterInfo: {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
    },
    owned: true,
  };
}

function parseStringArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [...fallback];
  const parsed = value.filter((entry): entry is T =>
    typeof entry === 'string' && allowed.includes(entry as T)
  );
  return parsed.length > 0 ? parsed : [...fallback];
}

export async function probeMediaPipeline(args: Record<string, unknown> = {}) {
  const mediaId = typeof args.mediaId === 'string' ? args.mediaId : '';
  const media = useMediaStore.getState().files.find((entry) => entry.id === mediaId);
  if (!media || media.type !== 'video') {
    return { success: false, error: `Video media not found: ${mediaId}` };
  }

  let sourceFile = media.file;
  if (!sourceFile) {
    const response = await fetch(media.url);
    if (!response.ok) {
      return { success: false, error: `Could not load media URL (${response.status})` };
    }
    sourceFile = new File([await response.blob()], media.name, { type: 'video/mp4' });
  }

  const loaded = await loadProxyVideoWithMP4Box(sourceFile, silentLogger);
  if (!loaded) {
    return { success: false, error: 'Could not demux video for pipeline probe' };
  }

  const centers = Array.isArray(args.centers)
    ? args.centers.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [0];
  const operations = parseStringArray(
    args.operations,
    [
      'none',
      'copy-native',
      'copy-rgba',
      'image-bitmap',
      'webgpu',
      'external-texture',
      'external-composite',
    ] as const,
    ['none', 'webgpu'] as const,
  );
  const hardwarePreferences = parseStringArray(
    args.hardwarePreferences,
    ['prefer-hardware', 'prefer-software', 'no-preference'] as const,
    ['prefer-hardware'] as const,
  );
  const flushModes = Array.isArray(args.flushModes)
    ? args.flushModes.filter((value): value is boolean => typeof value === 'boolean')
    : [false];
  const outputWidth = typeof args.outputWidth === 'number' && Number.isFinite(args.outputWidth)
    ? Math.max(16, Math.min(7680, Math.round(args.outputWidth)))
    : loaded.videoTrack.video.width;
  const outputHeight = typeof args.outputHeight === 'number' && Number.isFinite(args.outputHeight)
    ? Math.max(16, Math.min(4320, Math.round(args.outputHeight)))
    : loaded.videoTrack.video.height;
  const gpuDeviceMode = args.gpuDeviceMode === 'engine' ? 'engine' : 'fresh';
  const gpu = operations.some((operation) =>
    operation === 'webgpu' ||
    operation === 'external-texture' ||
    operation === 'external-composite'
  )
    ? await readGpuContext(gpuDeviceMode)
    : { device: null, adapterInfo: null, owned: false };
  const results: Array<Record<string, unknown>> = [];
  const sequences: Array<Record<string, unknown>> = [];
  const skipSingleFrameProbes = args.skipSingleFrameProbes === true;
  const sequenceFrameCount = typeof args.sequenceFrameCount === 'number' && Number.isFinite(args.sequenceFrameCount)
    ? Math.max(0, Math.min(120, Math.round(args.sequenceFrameCount)))
    : 0;
  const sequenceImplementations = parseStringArray(
    args.sequenceImplementations,
    ['custom', 'player'] as const,
    ['custom'] as const,
  );
  const sequenceOutputSinks = parseStringArray(
    args.sequenceOutputSinks,
    ['texture', 'offscreen-canvas'] as const,
    ['texture'] as const,
  );
  const sequenceCanvasConsumers = parseStringArray(
    args.sequenceCanvasConsumers,
    ['none', 'capture', 'encode'] as const,
    ['none'] as const,
  );
  const sequenceFps = typeof args.sequenceFps === 'number' && Number.isFinite(args.sequenceFps)
    ? Math.max(1, Math.min(240, args.sequenceFps))
    : 24;
  const sequenceBitrate = typeof args.sequenceBitrate === 'number' && Number.isFinite(args.sequenceBitrate)
    ? Math.max(1_000_000, Math.min(100_000_000, Math.round(args.sequenceBitrate)))
    : 15_000_000;

  if (!skipSingleFrameProbes) {
    for (const centerSeconds of centers) {
      for (const hardwareAcceleration of hardwarePreferences) {
        for (const flushBeforeOperation of flushModes) {
          for (const operation of operations) {
            results.push(await runTargetProbe({
              samples: loaded.samples,
              codecConfig: loaded.codecConfig,
              centerSeconds,
              operation,
              hardwareAcceleration,
              flushBeforeOperation,
              gpuDevice: gpu.device,
              outputWidth,
              outputHeight,
            }));
          }
        }
      }
    }
  }

  if (sequenceFrameCount > 0 && gpu.device) {
    const playerSourceBuffer = sequenceImplementations.includes('player')
      ? await sourceFile.arrayBuffer()
      : null;
    for (const centerSeconds of centers) {
      for (const hardwareAcceleration of hardwarePreferences) {
        if (sequenceImplementations.includes('custom')) {
          sequences.push(await runSequenceProbe({
            samples: loaded.samples,
            codecConfig: loaded.codecConfig,
            centerSeconds,
            frameCount: sequenceFrameCount,
            hardwareAcceleration,
            gpuDevice: gpu.device,
            outputWidth,
            outputHeight,
          }));
        }
        if (sequenceImplementations.includes('player') && playerSourceBuffer) {
          for (const outputSink of sequenceOutputSinks) {
            for (const canvasConsumer of sequenceCanvasConsumers) {
              sequences.push(await runPlayerSequenceProbe({
                sourceBuffer: playerSourceBuffer.slice(0),
                samples: loaded.samples,
                centerSeconds,
                frameCount: sequenceFrameCount,
                gpuDevice: gpu.device,
                outputWidth,
                outputHeight,
                outputSink,
                canvasConsumer,
                fps: sequenceFps,
                bitrate: sequenceBitrate,
              }));
            }
          }
        }
      }
    }
  }

  if (gpu.owned) gpu.device?.destroy();
  return {
    success: true,
    data: {
      environment: {
        userAgent: navigator.userAgent,
        adapterInfo: gpu.adapterInfo,
        gpuDeviceMode,
      },
      media: {
        id: media.id,
        name: media.name,
        codec: loaded.videoTrack.codec,
        width: loaded.videoTrack.video.width,
        height: loaded.videoTrack.video.height,
        durationSeconds: round(loaded.duration),
        frameRate: round(loaded.proxyFps),
        outputWidth,
        outputHeight,
      },
      results,
      sequences,
    },
  };
}
