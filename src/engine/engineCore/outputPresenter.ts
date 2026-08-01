// Final-frame presentation operations for WebGPUEngine (extracted, packet 345).
//
// Every function here blits, clears, or reads the ping-pong output owned by
// RenderTargetManager, selecting the final texture via
// Compositor.getLastRenderWasPing(). Null-guards mirror the historical
// WebGPUEngine behavior: members that survive device loss are reached through
// the resource set (null only before first initialization), members cleared
// on device loss keep explicit null checks.

import { useRenderTargetStore } from '../../stores/renderTargetStore';
import type { OutputSlice } from '../../types/outputSlice';
import type { RenderDispatcher } from '../render/RenderDispatcher';
import type { EngineResourceSet } from './engineResources';

export interface OutputPresenterDeps {
  getDevice(): GPUDevice | null;
  getResources(): EngineResourceSet | null;
  getPreviewContext(): GPUCanvasContext | null;
  getTargetContext(targetId: string): GPUCanvasContext | null;
  getRenderDispatcher(): RenderDispatcher | null;
}

export function cacheActiveCompOutput(deps: OutputPresenterDeps, compositionId: string): void {
  const res = deps.getResources();
  if (!res) return;
  const pingTex = res.renderTargetManager.getPingTexture();
  const pongTex = res.renderTargetManager.getPongTexture();
  if (!pingTex || !pongTex) return;

  const { width, height } = res.renderTargetManager.getResolution();
  const finalIsPing = !res.compositor.getLastRenderWasPing();
  const sourceTexture = finalIsPing ? pingTex : pongTex;

  res.nestedCompRenderer.cacheActiveCompOutput(compositionId, sourceTexture, width, height);
}

export function copyMainOutputToPreview(deps: OutputPresenterDeps, canvasId: string): boolean {
  const device = deps.getDevice();
  const res = deps.getResources();
  const canvasContext = deps.getTargetContext(canvasId);
  if (!device || !res || !canvasContext) return false;
  const { sampler, outputPipeline } = res;
  const pingView = res.renderTargetManager.getPingView();
  const pongView = res.renderTargetManager.getPongView();
  if (!outputPipeline || !sampler || !pingView || !pongView) return false;

  const finalIsPing = !res.compositor.getLastRenderWasPing();
  const finalView = finalIsPing ? pingView : pongView;

  const commandEncoder = device.createCommandEncoder();
  const outputBindGroup = outputPipeline.getOutputBindGroup(sampler, finalView, finalIsPing);
  outputPipeline.renderToCanvas(commandEncoder, canvasContext, outputBindGroup);
  device.queue.submit([commandEncoder.finish()]);
  return true;
}

export function copyNestedCompTextureToPreview(
  deps: OutputPresenterDeps,
  canvasId: string,
  compositionId: string,
  renderOccurrenceKey?: string,
): boolean {
  const device = deps.getDevice();
  const res = deps.getResources();
  const canvasContext = deps.getTargetContext(canvasId);
  const compTexture = res?.nestedCompRenderer.getTexture(compositionId, renderOccurrenceKey);

  if (!device || !res || !canvasContext || !compTexture || !res.outputPipeline || !res.sampler) return false;

  const commandEncoder = device.createCommandEncoder();
  const outputBindGroup = res.outputPipeline.createOutputBindGroup(res.sampler, compTexture.view);
  res.outputPipeline.renderToCanvas(commandEncoder, canvasContext, outputBindGroup);
  device.queue.submit([commandEncoder.finish()]);
  return true;
}

/**
 * Render sliced output to a specific canvas using the main composited output.
 * Used by TargetPreview to preview sliced output for a target.
 */
export function renderSlicedToCanvas(
  deps: OutputPresenterDeps,
  canvasId: string,
  slices: OutputSlice[],
): boolean {
  const device = deps.getDevice();
  const res = deps.getResources();
  const canvasContext = deps.getTargetContext(canvasId);
  if (!device || !res || !canvasContext) return false;
  const { sampler, slicePipeline } = res;
  const pingView = res.renderTargetManager.getPingView();
  const pongView = res.renderTargetManager.getPongView();
  if (!slicePipeline || !sampler || !pingView || !pongView) return false;

  const enabledSlices = slices.filter((s) => s.enabled);
  if (enabledSlices.length === 0) return false;

  const finalIsPing = !res.compositor.getLastRenderWasPing();
  const finalView = finalIsPing ? pingView : pongView;

  slicePipeline.buildVertexBuffer(enabledSlices);

  const commandEncoder = device.createCommandEncoder();
  slicePipeline.renderSlicedOutput(commandEncoder, canvasContext, finalView, sampler);
  device.queue.submit([commandEncoder.finish()]);
  return true;
}

export function clearFrame(deps: OutputPresenterDeps): void {
  const device = deps.getDevice();
  const res = deps.getResources();
  const pingView = res?.renderTargetManager.getPingView();
  const pongView = res?.renderTargetManager.getPongView();
  if (!device || !res || !pingView || !pongView) return;

  const commandEncoder = device.createCommandEncoder();

  const clearPing = commandEncoder.beginRenderPass({
    colorAttachments: [{ view: pingView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
  });
  clearPing.end();

  const clearPong = commandEncoder.beginRenderPass({
    colorAttachments: [{ view: pongView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
  });
  clearPong.end();

  const { width, height } = res.renderTargetManager.getResolution();
  res.outputPipeline?.updateResolution(width, height);
  if (res.outputPipeline && res.sampler) {
    const previewContext = deps.getPreviewContext();
    if (previewContext) {
      const mainBindGroup = res.outputPipeline.createOutputBindGroup(res.sampler, pingView, 'normal');
      res.outputPipeline.renderToCanvas(commandEncoder, previewContext, mainBindGroup);
    }
    const activeTargets = useRenderTargetStore.getState().getActiveCompTargets();
    for (const target of activeTargets) {
      const ctx = deps.getTargetContext(target.id);
      if (!ctx) continue;
      const targetBindGroup = res.outputPipeline.createOutputBindGroup(res.sampler, pingView, target.showTransparencyGrid ? 'grid' : 'normal');
      res.outputPipeline.renderToCanvas(commandEncoder, ctx, targetBindGroup);
    }
  }

  device.queue.submit([commandEncoder.finish()]);
}

export function getLastRenderedTexture(deps: OutputPresenterDeps): GPUTexture | null {
  const res = deps.getResources();
  if (!res) return null;
  if (!deps.getRenderDispatcher()?.lastRenderHadContent) return null;
  return res.compositor.getLastRenderWasPing()
    ? res.renderTargetManager.getPingTexture()
    : res.renderTargetManager.getPongTexture();
}
