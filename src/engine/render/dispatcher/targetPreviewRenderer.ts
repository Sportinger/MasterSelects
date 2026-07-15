import type { Layer } from '../../core/types';
import type { SceneCameraConfig } from '../../scene/types';
import { getMotionRenderSize } from '../../motion/MotionTypes';
import { useRenderTargetStore } from '../../../stores/renderTargetStore';
import type { RenderDeps } from '../RenderDispatcher';
import type { PreviewFrameRecorder } from './dispatcherTelemetry';
import { TargetPreviewLayerCollector } from './targetPreviewLayerCollector';

interface TargetBuffers {
  device: GPUDevice;
  width: number;
  height: number;
  pingTexture: GPUTexture;
  pongTexture: GPUTexture;
  effectTexture: GPUTexture;
  effectTexture2: GPUTexture;
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  effectView: GPUTextureView;
  effectView2: GPUTextureView;
}

type Process3DLayers = (
  layerData: ReturnType<TargetPreviewLayerCollector['collect']>,
  device: GPUDevice,
  width: number,
  height: number,
  cameraOverride?: SceneCameraConfig | null,
  targetId?: string,
) => void;

export class TargetPreviewRenderer {
  private readonly deps: RenderDeps;
  private readonly layerCollector: TargetPreviewLayerCollector;
  private readonly recordMainPreviewFrame: PreviewFrameRecorder;
  private readonly process3DLayers: Process3DLayers;
  private readonly getEffectiveTimelineTime: () => number;
  private readonly targetBuffers = new Map<string, TargetBuffers>();

  constructor(
    deps: RenderDeps,
    recordMainPreviewFrame: PreviewFrameRecorder,
    process3DLayers: Process3DLayers,
    getEffectiveTimelineTime: () => number,
  ) {
    this.deps = deps;
    this.layerCollector = new TargetPreviewLayerCollector(deps);
    this.recordMainPreviewFrame = recordMainPreviewFrame;
    this.process3DLayers = process3DLayers;
    this.getEffectiveTimelineTime = getEffectiveTimelineTime;
  }

  private getTargetBuffers(canvasId: string, device: GPUDevice, width: number, height: number): TargetBuffers {
    const current = this.targetBuffers.get(canvasId);
    if (current?.device === device && current.width === width && current.height === height) {
      return current;
    }
    current?.pingTexture.destroy();
    current?.pongTexture.destroy();
    current?.effectTexture.destroy();
    current?.effectTexture2.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const pingTexture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
    const pongTexture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
    const effectTexture = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
    const effectTexture2 = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage });
    const buffers = {
      device,
      width,
      height,
      pingTexture,
      pongTexture,
      effectTexture,
      effectTexture2,
      pingView: pingTexture.createView(),
      pongView: pongTexture.createView(),
      effectView: effectTexture.createView(),
      effectView2: effectTexture2.createView(),
    };
    this.targetBuffers.set(canvasId, buffers);
    return buffers;
  }

  private releaseTargetBuffers(canvasId: string): void {
    const buffers = this.targetBuffers.get(canvasId);
    buffers?.pingTexture.destroy();
    buffers?.pongTexture.destroy();
    buffers?.effectTexture.destroy();
    buffers?.effectTexture2.destroy();
    this.targetBuffers.delete(canvasId);
  }

  releaseTarget(canvasId: string): void {
    this.releaseTargetBuffers(canvasId);
  }

  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    const d = this.deps;
    if (d.isRecovering()) return;

    const device = d.getDevice();
    const canvasContext = d.targetCanvases.get(canvasId)?.context;
    if (!device || !canvasContext || !d.compositorPipeline || !d.outputPipeline || !d.sampler || !d.renderTargetManager) return;

    d.compositorPipeline.beginFrame();
    const layerData = this.layerCollector.collect(layers);
    const targets = useRenderTargetStore.getState().targets;
    const target = targets.get(canvasId);
    const viewportOverride = target?.viewportOverride;
    const baseResolution = d.renderTargetManager.getResolution();
    const maxTextureSize = device.limits.maxTextureDimension2D;
    const width = Math.max(1, Math.min(maxTextureSize, Math.round(viewportOverride?.width ?? baseResolution.width)));
    const height = Math.max(1, Math.min(maxTextureSize, Math.round(viewportOverride?.height ?? baseResolution.height)));
    const usesLocalBuffers = Boolean(viewportOverride);
    if (!usesLocalBuffers) this.releaseTargetBuffers(canvasId);
    const localBuffers = usesLocalBuffers
      ? this.getTargetBuffers(canvasId, device, width, height)
      : null;
    const indPingView = localBuffers?.pingView ?? d.renderTargetManager?.getIndependentPingView();
    const indPongView = localBuffers?.pongView ?? d.renderTargetManager?.getIndependentPongView();
    if (!indPingView || !indPongView) return;

    this.process3DLayers(layerData, device, width, height, viewportOverride?.cameraOverride, canvasId);

    const showGrid = target?.showTransparencyGrid ?? false;

    d.outputPipeline.updateResolution(width, height);

    if (layerData.length === 0) {
      const commandEncoder = device.createCommandEncoder();
      const blackTex = d.renderTargetManager.getBlackTexture();
      if (blackTex) {
        const blackView = blackTex.createView();
        const blackBindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, blackView, showGrid ? 'grid' : 'normal');
        d.outputPipeline.renderToCanvas(commandEncoder, canvasContext, blackBindGroup);
        this.recordMainPreviewFrame('target-empty');
      }
      device.queue.submit([commandEncoder.finish()]);
      return;
    }

    const commandEncoder = device.createCommandEncoder();
    for (const data of layerData) {
      if (data.layer.source?.type !== 'motion') continue;
      const rendered = d.motionRenderer?.renderLayer(data.layer, commandEncoder);
      const size = rendered ?? getMotionRenderSize(data.layer.source.motion);
      data.textureView = rendered?.textureView ?? null;
      data.sourceWidth = size.width;
      data.sourceHeight = size.height;
    }

    let hasNestedComps = false;
    if (viewportOverride && d.nestedCompRenderer) {
      for (let i = layerData.length - 1; i >= 0; i--) {
        const data = layerData[i];
        const nested = data.layer.source?.nestedComposition;
        if (!nested) continue;
        hasNestedComps = true;
        const view = d.nestedCompRenderer.preRender(
          nested.compositionId,
          nested.layers,
          nested.width,
          nested.height,
          commandEncoder,
          d.sampler,
          nested.currentTime,
          nested.sceneClips,
          nested.sceneTracks,
          0,
          false,
          'preview',
        );
        if (view) data.textureView = view;
        else layerData.splice(i, 1);
      }
    }

    if (viewportOverride && localBuffers && d.compositor) {
      const result = d.compositor.composite(layerData, commandEncoder, {
        device,
        sampler: d.sampler,
        pingView: localBuffers.pingView,
        pongView: localBuffers.pongView,
        outputWidth: width,
        outputHeight: height,
        skipEffects: false,
        effectTempTexture: localBuffers.effectTexture,
        effectTempView: localBuffers.effectView,
        effectTempTexture2: localBuffers.effectTexture2,
        effectTempView2: localBuffers.effectView2,
        motionTime: this.getEffectiveTimelineTime(),
        particleQuality: 'preview',
      });
      const outputBindGroup = d.outputPipeline.createOutputBindGroup(
        d.sampler,
        result.finalView,
        showGrid ? 'grid' : 'normal',
      );
      d.outputPipeline.renderToCanvas(commandEncoder, canvasContext, outputBindGroup);
      this.recordMainPreviewFrame('target-canvas', layerData);
      device.queue.submit([commandEncoder.finish()]);
      if (hasNestedComps) d.nestedCompRenderer?.cleanupPendingTextures();
      return;
    }

    let readView = indPingView;
    let writeView = indPongView;

    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: readView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    });
    clearPass.end();

    for (const data of layerData) {
      const layer = data.layer;
      const uniformBuffer = d.compositorPipeline!.getOrCreateUniformBuffer(layer.id);
      const sourceAspect = data.sourceWidth / data.sourceHeight;
      const outputAspect = width / height;
      const maskLookupId = layer.maskClipId || layer.id;
      const maskManager = d.maskTextureManager!;
      const maskInfo = maskManager.getMaskInfo(maskLookupId) ?? { hasMask: false, view: maskManager.getWhiteMaskView() };
      const hasMask = maskInfo.hasMask;
      const maskTextureView = maskInfo.view;

      d.compositorPipeline!.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      if (data.isVideo && data.externalTexture) {
        pipeline = d.compositorPipeline!.getExternalCompositePipeline()!;
        bindGroup = d.compositorPipeline!.createExternalCompositeBindGroup(d.sampler!, readView, data.externalTexture, uniformBuffer, maskTextureView);
      } else if (data.textureView) {
        pipeline = d.compositorPipeline!.getCompositePipeline()!;
        bindGroup = d.compositorPipeline!.createCompositeBindGroup(d.sampler!, readView, data.textureView, uniformBuffer, maskTextureView);
      } else {
        continue;
      }

      const compositePass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
      });
      compositePass.setPipeline(pipeline);
      compositePass.setBindGroup(0, bindGroup);
      compositePass.draw(6);
      compositePass.end();

      [readView, writeView] = [writeView, readView];
    }

    const outputBindGroup = d.outputPipeline!.createOutputBindGroup(d.sampler!, readView, showGrid ? 'grid' : 'normal');
    d.outputPipeline!.renderToCanvas(commandEncoder, canvasContext, outputBindGroup);
    this.recordMainPreviewFrame('target-canvas', layerData);

    device.queue.submit([commandEncoder.finish()]);
  }
}
