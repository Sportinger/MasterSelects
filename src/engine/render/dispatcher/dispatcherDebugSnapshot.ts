import type { Layer, LayerRenderData } from '../../core/types';
import { Logger } from '../../../services/logger';

const log = Logger.create('RenderDispatcher');

export interface RenderDispatcherDebugSnapshot {
  inputLayers: number;
  collectedLayerData: number;
  inputLayerDetails?: Array<{
    id: string;
    sourceClipId?: string;
    sourceType?: string;
    mediaTime?: number;
    opacity: number;
  }>;
  collectedLayerDetails?: Array<{
    id: string;
    sourceClipId?: string;
    sourceType?: string;
    targetMediaTime?: number;
    displayedMediaTime?: number;
    previewPath?: string;
  }>;
  after3DLayerData: number;
  gaussianCandidates: number;
  gaussianRendered: number;
  gaussianPendingLoad: number;
  gaussianMissingUrl: number;
  gaussianNoTextureView: number;
  finalLayerData: number;
  splatSequence?: {
    targetSceneKey?: string;
    renderedSceneKey?: string;
    mode: 'target' | 'held' | 'missing';
    visualFrameChangesLastSecond: number;
    backgroundLoads: number;
  };
}

export class DispatcherDebugSnapshotFacet {
  private lastSceneRenderDebugKey = '';

  createRenderDebugSnapshot(
    inputLayers: Layer[],
    layerData: LayerRenderData[],
  ): RenderDispatcherDebugSnapshot {
    return {
      inputLayers: inputLayers.length,
      collectedLayerData: layerData.length,
      inputLayerDetails: inputLayers.map((layer) => ({
        id: layer.id,
        sourceClipId: layer.sourceClipId,
        sourceType: layer.source?.type,
        mediaTime: layer.source?.mediaTime,
        opacity: layer.opacity,
      })),
      collectedLayerDetails: layerData.map((data) => ({
        id: data.layer.id,
        sourceClipId: data.layer.sourceClipId,
        sourceType: data.layer.source?.type,
        targetMediaTime: data.targetMediaTime,
        displayedMediaTime: data.displayedMediaTime,
        previewPath: data.previewPath,
      })),
      after3DLayerData: layerData.length,
      gaussianCandidates: layerData.filter((data) => data.layer.source?.type === 'gaussian-splat').length,
      gaussianRendered: 0,
      gaussianPendingLoad: 0,
      gaussianMissingUrl: 0,
      gaussianNoTextureView: 0,
      finalLayerData: layerData.length,
    };
  }

  recordSceneRenderInputChanged(
    layers: Layer[],
    layerData: LayerRenderData[],
  ): void {
    const sceneRenderDebugPayload = {
      input: layers.map((layer) => layer ? {
        id: layer.id,
        sourceClipId: layer.sourceClipId,
        sourceType: layer.source?.type,
        hasGaussianSplatUrl: !!layer.source?.gaussianSplatUrl,
        is3D: layer.is3D === true,
        visible: layer.visible !== false,
        opacity: layer.opacity,
      } : null),
      collected: layerData.map((data) => ({
        id: data.layer.id,
        sourceClipId: data.layer.sourceClipId,
        sourceType: data.layer.source?.type,
        hasGaussianSplatUrl: !!data.layer.source?.gaussianSplatUrl,
        is3D: data.layer.is3D === true,
        hasTextureView: !!data.textureView,
      })),
    };
    const sceneRenderDebugKey = JSON.stringify(sceneRenderDebugPayload);
    if (sceneRenderDebugKey !== this.lastSceneRenderDebugKey) {
      this.lastSceneRenderDebugKey = sceneRenderDebugKey;
      log.debug('Shared scene render input changed', sceneRenderDebugPayload);
    }
  }

  setSplatSequenceDebugSnapshot(
    renderSnapshot: RenderDispatcherDebugSnapshot | null,
    splatSequenceSnapshot: NonNullable<RenderDispatcherDebugSnapshot['splatSequence']>,
  ): void {
    if (renderSnapshot) {
      renderSnapshot.splatSequence = splatSequenceSnapshot;
    }
  }
}
