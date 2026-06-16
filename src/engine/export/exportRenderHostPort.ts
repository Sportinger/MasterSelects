import type { ModelSequenceData } from '../../types/mediaSequences';
import type { Layer } from '../core/types';
import type { GaussianSplatSceneLoadRequest } from '../render/dispatcher/gaussianSequenceFacet';
import { engine } from '../WebGPUEngine';

export interface ExportRenderHostPort {
  getOutputDimensions(): { width: number; height: number };
  setResolution(width: number, height: number): void;
  setExporting(exporting: boolean): void;
  initExportCanvas(width: number, height: number, stackedAlpha: boolean): boolean;
  isDeviceValid(): boolean;
  setRenderTimeOverride(time: number | null): void;
  ensureExportLayersReady(layers: Layer[]): Promise<void>;
  render(layers: Layer[]): void;
  createVideoFrameFromExport(timestamp: number, duration: number): Promise<VideoFrame | null>;
  readPixels(): Promise<Uint8ClampedArray | null>;
  cleanupExportCanvas(): void;
  hasMaskTexture(layerId: string): boolean;
  updateMaskTexture(layerId: string, imageData: ImageData | null): void;
  removeMaskTexture(layerId: string): void;
  ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean>;
  ensureSceneRendererInitialized(width: number, height: number): Promise<boolean>;
  preloadSceneModelAsset(
    url: string,
    fileName: string,
    modelSequence?: ModelSequenceData,
  ): Promise<boolean>;
}

class MainExportRenderHostPort implements ExportRenderHostPort {
  getOutputDimensions(): { width: number; height: number } {
    return engine.getOutputDimensions();
  }

  setResolution(width: number, height: number): void {
    engine.setResolution(width, height);
  }

  setExporting(exporting: boolean): void {
    engine.setExporting(exporting);
  }

  initExportCanvas(width: number, height: number, stackedAlpha: boolean): boolean {
    return engine.initExportCanvas(width, height, stackedAlpha);
  }

  isDeviceValid(): boolean {
    return engine.isDeviceValid();
  }

  setRenderTimeOverride(time: number | null): void {
    engine.setRenderTimeOverride(time);
  }

  ensureExportLayersReady(layers: Layer[]): Promise<void> {
    return engine.ensureExportLayersReady(layers);
  }

  render(layers: Layer[]): void {
    engine.render(layers);
  }

  createVideoFrameFromExport(timestamp: number, duration: number): Promise<VideoFrame | null> {
    return engine.createVideoFrameFromExport(timestamp, duration);
  }

  readPixels(): Promise<Uint8ClampedArray | null> {
    return engine.readPixels();
  }

  cleanupExportCanvas(): void {
    engine.cleanupExportCanvas();
  }

  hasMaskTexture(layerId: string): boolean {
    return engine.hasMaskTexture(layerId);
  }

  updateMaskTexture(layerId: string, imageData: ImageData | null): void {
    engine.updateMaskTexture(layerId, imageData);
  }

  removeMaskTexture(layerId: string): void {
    engine.removeMaskTexture(layerId);
  }

  ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    return engine.ensureGaussianSplatSceneLoaded(options);
  }

  ensureSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    return engine.ensureSceneRendererInitialized(width, height);
  }

  preloadSceneModelAsset(
    url: string,
    fileName: string,
    modelSequence?: ModelSequenceData,
  ): Promise<boolean> {
    return modelSequence
      ? engine.preloadSceneModelAsset(url, fileName, modelSequence)
      : engine.preloadSceneModelAsset(url, fileName);
  }
}

export const exportRenderHostPort: ExportRenderHostPort = new MainExportRenderHostPort();
