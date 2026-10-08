import { StrandIdCapture } from './passes/StrandIdCapture';
import { CurveWakePass } from './wake/CurveWakePass';
import { CurveLabelPass } from './labels/CurveLabelPass';
import { Logger } from '../../services/logger';
import { flockGpuTimings } from '../flock/gpu/FlockGpuTimings';
import { SlitScanSceneSurfaces } from './sceneRenderer/SlitScanSceneSurfaces';
import { StrandProjectedEffects } from './sceneRenderer/StrandProjectedEffects';
import { hasPendingTemporalPreparations, isCollectingTemporalPreparations } from '../../effects/time/temporalResourcePreparation';
import { getGaussianSplatGpuRenderer } from '../gaussian/core/GaussianSplatGpuRenderer';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';
import { resolveSharedSplatSceneKey } from '../scene/runtime/SharedSplatRuntimeUtils';
import type {
  SceneCamera,
  SceneFaceCableLayer,
  SceneFlockLayer,
  SceneGizmoRenderOptions,
  SceneLayer3DData,
  SceneLightLayer,
  ScenePlaneLayer,
  SceneSplatEffectorRuntimeData,
  SceneSplatLayer,
  SceneStrandLayer,
  SceneVoxelLayer,
} from '../scene/types';
import type { ModelSequenceData } from '../../types';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import { ModelRuntimeCache } from './assets/ModelRuntimeCache';
import { EffectorCompute } from './passes/EffectorCompute';
import { FlockPass } from './passes/FlockPass';
import { StrandPass } from './passes/StrandPass';
import type { NativeSceneHost } from './sceneRenderer/NativeSceneHost';
import { GizmoPass } from './passes/GizmoPass';
import { MeshPass, type SceneNativeMeshLayer } from './passes/MeshPass';
import { PlanePass } from './passes/PlanePass';
import { FaceCablePass } from './passes/FaceCablePass';
import { SplatPass } from './passes/SplatPass';
import { VoxelPass } from './passes/VoxelPass';
import {
  SCENE_COLOR_FORMAT,
  SCENE_DEPTH_FORMAT,
  SCENE_GIZMO_FORMAT,
  SPLAT_SOFT_DEPTH_ALPHA_CUTOFF,
} from './sceneRenderer/constants';
import {
  canRenderNativeScene,
  sortBySceneLayerDepth,
  splitMeshLayers,
  splitPlaneLayers,
} from './sceneRenderer/drawPlan';
import {
  collectRetainedModelUrls,
  getModelSequencePreloadOptions,
  prepareModelLayerForRender,
} from './sceneRenderer/modelSequence';
import { RasterDepthOfField } from './sceneRenderer/rasterDepthOfField';
import { SceneToneMap } from './sceneRenderer/sceneToneMap';
import { PathTraceRuntime } from './pathtrace/runtime/PathTraceRuntime';
import { collectPathTraceInputs, NO_STRAND_SHADOWS } from './sceneRenderer/pathTracedFrame';
import { RasterSubSampleAccumulator } from './sceneRenderer/rasterSubSamples';
import { onEnvironmentIrradianceReady } from './sceneRenderer/environmentIrradiance';
import type { NativeSceneRenderOptions } from './sceneRenderer/renderOptions';
import { createSceneTargets, hasMatchingSceneTargets, type SceneTargets } from './sceneRenderer/targets';
import {
  LayerSpaceEffectRenderer,
  type LayerSpaceEffectContext,
} from './sceneRenderer/LayerSpaceEffectRenderer';

const log = Logger.create('NativeSceneRenderer');

export class NativeSceneRuntime {
  private host: NativeSceneHost;
  private initialized = false;
  private sceneTexture: GPUTexture | null = null;
  private sceneView: GPUTextureView | null = null;
  private sceneDisplayView: GPUTextureView | null = null;
  private sceneGizmoTexture: GPUTexture | null = null;
  private sceneGizmoView: GPUTextureView | null = null;
  private sceneDepthTexture: GPUTexture | null = null;
  private sceneDepthView: GPUTextureView | null = null;
  private readonly sceneTargets = new Map<string, SceneTargets>();
  private readonly toneMap = new SceneToneMap();
  private depthOfField?: RasterDepthOfField;
  private readonly pathTrace = new PathTraceRuntime(() => this.host.requestRender?.());
  private readonly rasterSubSamples = new RasterSubSampleAccumulator();
  private readonly planePass = new PlanePass();
  private readonly faceCablePass = new FaceCablePass();
  private readonly meshPass = new MeshPass();
  private readonly gizmoPass = new GizmoPass();
  private readonly splatPass = new SplatPass();
  private readonly voxelPass = new VoxelPass();
  private strandPass = new StrandPass(() => this.host.requestRender?.());
  private flockPass: FlockPass;
  private readonly effectorCompute = new EffectorCompute();
  private readonly modelRuntimeCache = new ModelRuntimeCache();
  private readonly lastRenderableModelSequenceUrls = new Map<string, string>();
  private readonly layerSpaceEffectRenderer = new LayerSpaceEffectRenderer();
  private slitScanSurfaces?: SlitScanSceneSurfaces;
  private strandImageEffects?: StrandProjectedEffects;
  private curveLabels?: CurveLabelPass;
  private curveWake?: CurveWakePass;
  private strandIds?: StrandIdCapture;
  captureStrandIds(clipId:string,time:number) {return (this.strandIds??=new StrandIdCapture()).capture(this.strandPass,clipId,time);}
  captureStrandTracking(clipId:string,time:number) {return (this.strandIds??=new StrandIdCapture()).captureTracking(clipId,time);}
  hasProjectedStrandEffects(targetKey = 'main'): boolean { return this.strandImageEffects?.hasApplied(targetKey) ?? false; }
  private readonly stopIrradianceListener: () => void;
  constructor(host: NativeSceneHost) {
    this.host = host;
    this.flockPass = new FlockPass(() => this.host.flockRuntime());
    // A loaded environment map changes the raster's environment light: draw again.
    this.stopIrradianceListener = onEnvironmentIrradianceReady(() => this.host.requestRender?.());
  }

  /** Rebind environment callbacks after HMR while retaining device/session state. */
  setHost(host: NativeSceneHost): void {
    this.host = host;
    this.strandIds?.clear();
    this.strandPass.dispose();this.strandPass=new StrandPass(()=>this.host.requestRender?.());
    this.curveLabels?.dispose(); this.curveLabels = undefined;
    this.curveWake?.dispose(); this.curveWake = undefined;
    this.depthOfField?.dispose();
    this.depthOfField = undefined;
    this.flockPass?.dispose?.();
    this.flockPass = new FlockPass(() => this.host.flockRuntime());
    if (this.slitScanSurfaces?.setHost) this.slitScanSurfaces.setHost(host);
    else if (this.slitScanSurfaces) {
      this.slitScanSurfaces.destroy();
      this.slitScanSurfaces = undefined;
    }
  }

  private get geometrySurfaces(): SlitScanSceneSurfaces {
    return this.slitScanSurfaces ??= new SlitScanSceneSurfaces(this.host);
  }

  private getSplatSceneKey(layer: SceneSplatLayer): string {
    return resolveSharedSplatSceneKey({
      clipId: layer.clipId,
      runtimeKey: layer.gaussianSplatRuntimeKey,
    });
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get needsPathTraceFrame(): boolean { return this.pathTrace.needsPreviewFrame; }
  beginNativeBenchmark() { return this.pathTrace.beginNativeBenchmark(); }

  async initialize(_width: number, _height: number): Promise<boolean> {
    this.initialized = true;
    return true;
  }

  async preloadModel(url: string, fileName: string, modelSequence?: ModelSequenceData): Promise<boolean> {
    if (!url) {
      return false;
    }

    this.modelRuntimeCache.touch(url, fileName);
    return this.modelRuntimeCache.preload(url, fileName, getModelSequencePreloadOptions(modelSequence));
  }

  pruneSceneTargets(activeTargetKeys: ReadonlySet<string>): void {
    for (const [key, targets] of this.sceneTargets) {
      if (activeTargetKeys.has(key)) continue;
      targets.texture.destroy();
      targets.displayTexture.destroy();
      targets.gizmoTexture?.destroy();
      targets.depthTexture.destroy();
      this.sceneTargets.delete(key);
      this.toneMap.releaseTarget(key);
      this.depthOfField?.releaseTarget(key);
      this.pathTrace.releaseTarget(key);
      this.rasterSubSamples.releaseTarget(key);
      this.layerSpaceEffectRenderer.releaseTarget(key);
      this.slitScanSurfaces?.releaseTarget(key);
      this.strandImageEffects?.releaseTarget(key);this.strandIds?.forget(key);
      this.faceCablePass.releaseTarget(key);
    }
  }

  releaseSceneTarget(targetKey: string): void {
    const targets = this.sceneTargets.get(targetKey);
    if (!targets) return;
    targets.texture.destroy();
    targets.displayTexture.destroy();
    targets.gizmoTexture?.destroy();
    targets.depthTexture.destroy();
    this.sceneTargets.delete(targetKey);
    this.toneMap.releaseTarget(targetKey);
    this.depthOfField?.releaseTarget(targetKey);
    this.pathTrace.releaseTarget(targetKey);
    this.rasterSubSamples.releaseTarget(targetKey);
    this.layerSpaceEffectRenderer.releaseTarget(targetKey);
    this.slitScanSurfaces?.releaseTarget(targetKey);
    this.strandImageEffects?.releaseTarget(targetKey);this.strandIds?.forget(targetKey);
    this.faceCablePass.releaseTarget(targetKey);
  }

  getGizmoOverlayView(targetKey: string = 'main'): GPUTextureView | null {
    return this.sceneTargets.get(targetKey)?.gizmoView ?? null;
  }

  renderScene(
    device: GPUDevice,
    layers: SceneLayer3DData[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
    maskTextureManager?: MaskTextureManager | null,
    targetKey: string = 'main',
    layerSpaceEffects?: LayerSpaceEffectContext,
    options?: NativeSceneRenderOptions,
  ): GPUTextureView | null {
    if (!this.initialized) {
      return null;
    }

    const planeLayers = this.planePass.collect(layers);
    const meshLayers = this.meshPass.collect(layers);
    const splatLayers = this.splatPass.collect(layers);
    const voxelLayers = this.voxelPass.collect(layers);
    const flockLayers = this.flockPass.collect(layers);
    const strandLayers = this.strandPass.collect(layers);
    const lightLayers = layers.filter((layer): layer is SceneLightLayer => layer.kind === 'light');
    const preparedMeshLayers = meshLayers.map((layer) =>
      layer.kind === 'model'
        ? prepareModelLayerForRender(
            layer,
            realtimePlayback,
            this.modelRuntimeCache,
            this.lastRenderableModelSequenceUrls,
          )
        : layer,
    );
    const nativeMeshLayers = this.meshPass.collectNativeLayers(preparedMeshLayers);

    if (!canRenderNativeScene(layers, planeLayers, nativeMeshLayers, splatLayers, lightLayers)) {
      return null;
    }

    const nativeSceneView = this.renderNativeScene(
      device,
      planeLayers,
      voxelLayers,
      flockLayers,
      nativeMeshLayers,
      splatLayers,
      lightLayers,
      layers.filter((layer): layer is SceneFaceCableLayer => layer.kind === 'face-cables'),
      strandLayers,
      camera,
      effectors,
      realtimePlayback,
      gizmo,
      maskTextureManager,
      targetKey,
      layerSpaceEffects,
      options,
    );
    if (!nativeSceneView) {
      return null;
    }

    log.debug('Rendered native shared scene frame', {
      totalLayers: layers.length,
      planes: planeLayers.length,
      meshes: meshLayers.length,
      splats: splatLayers.length,
      voxels: voxelLayers.length,
      flocks: flockLayers.length,
      strands: strandLayers.length,
      lights: lightLayers.length,
    });
    return nativeSceneView;
  }

  dispose(): void {
    for (const targets of this.sceneTargets.values()) {
      targets.texture.destroy();
      targets.displayTexture.destroy();
      targets.gizmoTexture?.destroy();
      targets.depthTexture.destroy();
    }
    this.sceneTargets.clear();
    this.sceneTexture = null;
    this.sceneView = null;
    this.sceneGizmoTexture = null;
    this.sceneGizmoView = null;
    this.sceneDepthTexture = null;
    this.sceneDepthView = null;
    this.sceneDisplayView = null;
    this.toneMap.dispose();
    this.depthOfField?.dispose();
    this.pathTrace.dispose();
    this.rasterSubSamples.dispose();
    this.stopIrradianceListener();
    this.initialized = false;
    this.planePass.dispose();
    this.faceCablePass.dispose();
    this.meshPass.dispose();
    this.voxelPass.dispose();
    this.strandPass.dispose();this.strandIds?.clear();
    this.flockPass.dispose();
    this.gizmoPass.dispose();
    this.layerSpaceEffectRenderer.destroy();
    this.slitScanSurfaces?.destroy(); this.slitScanSurfaces = undefined;
    this.strandImageEffects?.destroy(); this.strandImageEffects = undefined;
    this.curveLabels?.dispose(); this.curveLabels = undefined;
    this.curveWake?.dispose(); this.curveWake = undefined;
    this.modelRuntimeCache.clear();
  }

  private ensureSceneTargets(device: GPUDevice, targetKey: string, width: number, height: number): void {
    let targets = this.sceneTargets.get(targetKey);
    if (!targets || !hasMatchingSceneTargets(targets, width, height)) {
      targets?.texture.destroy();
      targets?.displayTexture.destroy();
      targets?.gizmoTexture?.destroy();
      targets?.depthTexture.destroy();
      targets = createSceneTargets(device, width, height);
      this.sceneTargets.set(targetKey, targets);
    }
    this.sceneTexture = targets.texture;
    this.sceneView = targets.view;
    this.sceneDisplayView = targets.displayView;
    this.sceneGizmoTexture = targets.gizmoTexture;
    this.sceneGizmoView = targets.gizmoView;
    this.sceneDepthTexture = targets.depthTexture;
    this.sceneDepthView = targets.depthView;
  }

  private renderNativeScene(
    device: GPUDevice,
    planeLayers: ScenePlaneLayer[],
    voxelLayers: SceneVoxelLayer[],
    flockLayers: SceneFlockLayer[],
    nativeMeshLayers: SceneNativeMeshLayer[],
    layers: SceneSplatLayer[],
    lightLayers: SceneLightLayer[],
    cableLayers: SceneFaceCableLayer[],
    strandLayers: SceneStrandLayer[],
    camera: SceneCamera,
    effectors: SceneSplatEffectorRuntimeData[],
    realtimePlayback: boolean,
    gizmo?: SceneGizmoRenderOptions | null,
    maskTextureManager?: MaskTextureManager | null,
    targetKey: string = 'main',
    layerSpaceEffects?: LayerSpaceEffectContext,
    options?: NativeSceneRenderOptions,
  ): GPUTextureView | null {
    const renderer = getGaussianSplatGpuRenderer();
    if (layers.length > 0 && !renderer.isInitialized) {
      renderer.initialize(device);
    }

    if (layers.length > 0 && !layers.every((layer) => renderer.hasScene(this.getSplatSceneKey(layer)))) {
      return null;
    }

    // Raster export sub-samples render with a jittered projection and are averaged before tone mapping.
    const engine = options?.exportFrame?.quality.engine ?? options?.renderSettings?.engine ?? 'raster';
    if (!options?.exportFrame) {
      if (engine !== 'path-traced') this.pathTrace.pausePreview(targetKey);
      else if (!this.pathTrace.canRenderPreview(device, targetKey)) {
        return this.sceneTargets.get(targetKey)?.displayView ?? null;
      }
    }
    const subSample = engine === 'raster' ? this.rasterSubSamples.begin(targetKey, options?.exportFrame, camera) : null;
    if (subSample) camera = subSample.camera;
    this.ensureSceneTargets(device, targetKey, camera.viewport.width, camera.viewport.height);
    this.planePass.ensureResources(device);
    this.meshPass.initialize(device, SCENE_DEPTH_FORMAT);
    this.voxelPass.initialize(device);
    this.gizmoPass.initialize(device, SCENE_GIZMO_FORMAT);
    if (
      !this.sceneTexture ||
      !this.sceneView ||
      !this.sceneDisplayView ||
      !this.sceneGizmoTexture ||
      !this.sceneGizmoView ||
      !this.sceneDepthTexture ||
      !this.sceneDepthView ||
      !this.planePass.isReady
    ) {
      return null;
    }

    const commandEncoder = device.createCommandEncoder();
    const gpuTimings = flockGpuTimings(device);
    try {
    if (layers.length > 0) {
      renderer.beginFrame();
    }
    const sortedLayers = sortBySceneLayerDepth(layers, camera);
    const temporaryBuffers: GPUBuffer[] = [];
    const { opaqueMeshes, transparentMeshes } = splitMeshLayers(
      nativeMeshLayers,
      camera,
      (layer) => this.meshPass.isTransparent(layer, this.modelRuntimeCache),
    );
    const activeModelUrls = collectRetainedModelUrls(
      nativeMeshLayers,
      this.lastRenderableModelSequenceUrls,
    );
    this.geometrySurfaces.begin(targetKey, planeLayers.filter(layer => !!layer.slitScanGeometry), camera, device);
    this.planePass.pruneTextureCache(new Set([...planeLayers, ...voxelLayers, ...cableLayers].map((layer) => layer.layerId)));
    const effectedTextureViews = layerSpaceEffects
      ? this.layerSpaceEffectRenderer.prepare({
          ...layerSpaceEffects,
          device,
          commandEncoder,
          layers: [...planeLayers, ...voxelLayers, ...cableLayers.map(layer => ({ ...layer, kind: 'plane' as const }))],
          targetKey,
          geometryCapture: (layer, frame) => {
            if (layer.kind === 'plane') this.geometrySurfaces.capture(targetKey, layer, camera, frame);
          },
          resolveSource: (layer) => {
            const view = this.planePass.resolveTextureView(device, layer);
            const cached = this.planePass.getCachedTexture(layer.layerId);
            return view && cached ? { view, width: cached.width, height: cached.height } : null;
          },
        })
      : new Map<string, GPUTextureView>();
    // Keep a visible image while the first motion field is prepared. Export
    // still waits for geometry through its temporal preparation barrier.
    const readySurfaces = planeLayers.filter(layer => !!layer.slitScanGeometry && this.geometrySurfaces.hasDraw(layer.layerId));
    const { opaquePlanes, transparentPlanes } = splitPlaneLayers(planeLayers.filter(layer => !layer.slitScanGeometry
      || (!isCollectingTemporalPreparations() && !this.geometrySurfaces.hasDraw(layer.layerId))), camera);
    this.meshPass.pruneModelCache(activeModelUrls);
    // Flock simulations advance (compute) before any scene render pass is opened.
    const flockPlans = this.flockPass.prepare(device, commandEncoder, flockLayers, realtimePlayback);
    const strandPlans = this.strandPass.prepare(device, strandLayers, temporaryBuffers);
    const readyVoxels = voxelLayers.flatMap((layer) => {
      const textureView = effectedTextureViews.get(layer.layerId) ?? this.planePass.resolveTextureView(device, layer);
      return textureView ? [{ layer, textureView }] : [];
    });
    // Path traced frames replace the mesh, plane, voxel and strand passes (and write scene depth for
    // the layers still rasterized over them); a scene beyond the device limits falls back to raster.
    // An export retry must not accumulate a placeholder or the previous geometry frame.
    const resourcesReady = !options?.exportFrame || !hasPendingTemporalPreparations();
    const pathTraced = resourcesReady && engine === 'path-traced' && !!options?.renderSettings && this.pathTrace.render({
      device, encoder: commandEncoder, targetKey, camera, lights: lightLayers, sceneView: this.sceneView, sceneDepthView: this.sceneDepthView,
      settings: options.renderSettings, exportFrame: options.exportFrame, realtime: realtimePlayback, temporaries: temporaryBuffers,
      ...collectPathTraceInputs(device, { strandPlans, meshLayers: nativeMeshLayers, planeLayers, meshPass: this.meshPass, planePass: this.planePass,
        modelRuntimeCache: this.modelRuntimeCache, effectors, effectedTextureViews, voxels: readyVoxels }),
      sphereSets: this.flockPass.pathTracePoints(device, flockPlans, camera),
    });
    // Strand shadow maps come before the opaque passes: lit meshes receive them, and opaque meshes
    // seen from a scene light cast into them.
    const strandShadows = pathTraced ? NO_STRAND_SHADOWS : this.strandPass.prepareShadows(device, commandEncoder, strandPlans, temporaryBuffers, lightLayers,
      (encoder, depth, viewMatrix, projectionMatrix) => this.meshPass.renderShadowCasters(device, encoder, depth,
        { viewMatrix, projectionMatrix }, opaqueMeshes, effectors, this.modelRuntimeCache, temporaryBuffers));

    // Shared native scene pass graph, phase 1:
    //   1. Opaque depth-writing geometry -> scene color + shared depth
    //   2. Splats -> scene color, depth-tested but no writes for full gaussian blending quality
    //   3. Splats -> shared soft depth mask, writing only high-alpha cores for cross-splat occlusion
    //   4. Transparent planes/materials and blended flock branches -> scene color after splats
    if (!pathTraced) {
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.sceneView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: this.sceneDepthView,
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
        label: 'native-scene-clear-pass',
      });
      clearPass.end();

      if (!this.meshPass.renderPrimitivePass(
        device,
        commandEncoder,
        this.sceneView,
        this.sceneDepthView,
        opaqueMeshes,
        camera,
        effectors,
        lightLayers,
        this.modelRuntimeCache,
        temporaryBuffers,
        false,
        strandShadows.receiver,
      )) {
        return null;
      }

      if (!this.planePass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, opaquePlanes, camera, false, temporaryBuffers, maskTextureManager, effectedTextureViews)) {
        return null;
      }
    }
    if (!this.faceCablePass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, cableLayers, lightLayers, camera, targetKey,
      layer => effectedTextureViews.get(layer.layerId) ?? this.planePass.resolveTextureView(device, layer), temporaryBuffers)) return null;

    if (!pathTraced && !this.voxelPass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, readyVoxels, camera, temporaryBuffers)) return null;
    if (!this.flockPass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, flockPlans, camera, 'opaque', temporaryBuffers, pathTraced)) return null;
    if (pathTraced) this.strandImageEffects?.releaseTarget(targetKey);
    else if (!(this.strandImageEffects ??= new StrandProjectedEffects()).render(targetKey, this.strandPass,
      device, commandEncoder, this.sceneView, this.sceneDepthView, strandShadows, camera, temporaryBuffers, layerSpaceEffects)) return null;

    for (const layer of sortedLayers) {
      const renderSettings = layer.gaussianSplatSettings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
      const sceneKey = this.getSplatSceneKey(layer);
      const layerEffectors = this.effectorCompute.resolveEffectorsForLayer(layer, effectors);
      const textureView = renderer.renderToTexture(
        sceneKey,
        camera,
        camera.viewport,
        commandEncoder,
        {
          clipLocalTime: layer.mediaTime,
          backgroundColor: 'transparent',
          outputView: this.sceneView,
          outputFormat: SCENE_COLOR_FORMAT,
          colorLoadOp: 'load',
          depthView: this.sceneDepthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
          depthWrite: false,
          layerOpacity: layer.opacity,
          splatScale: renderSettings.splatScale,
          nearPlane: renderSettings.nearPlane,
          farPlane: renderSettings.farPlane,
          depthAlphaCutoff: 0,
          effectors: layerEffectors,
          worldMatrix: layer.worldMatrix,
          maxSplats: renderSettings.maxSplats,
          particleSettings: layer.gaussianSplatSettings?.particle,
          graphBranch: layer.splatGraphBranch,
          // Paused preview uses the same worker depth-order cadence as playback.
          // The GPU "precise" path remains reserved for export.
          precise: layer.preciseSplatSorting === true,
          sortFrequency: layer.preciseSplatSorting === true ? 1 : renderSettings.sortFrequency,
          temporalSettings: layer.gaussianSplatSettings?.temporal,
        },
      );

      if (!textureView) {
        return null;
      }

      const depthMaskView = renderer.renderToTexture(
        sceneKey,
        camera,
        camera.viewport,
        commandEncoder,
        {
          clipLocalTime: layer.mediaTime,
          backgroundColor: 'transparent',
          outputView: this.sceneView,
          outputFormat: SCENE_COLOR_FORMAT,
          colorLoadOp: 'load',
          depthView: this.sceneDepthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
          depthWrite: true,
          colorWrite: false,
          layerOpacity: layer.opacity,
          splatScale: renderSettings.splatScale,
          nearPlane: renderSettings.nearPlane,
          farPlane: renderSettings.farPlane,
          depthAlphaCutoff: SPLAT_SOFT_DEPTH_ALPHA_CUTOFF,
          effectors: layerEffectors,
          worldMatrix: layer.worldMatrix,
          maxSplats: renderSettings.maxSplats,
          particleSettings: layer.gaussianSplatSettings?.particle,
          graphBranch: layer.splatGraphBranch,
          precise: false,
          sortFrequency: 0,
          temporalSettings: layer.gaussianSplatSettings?.temporal,
        },
      );

      if (!depthMaskView) {
        return null;
      }
    }

    if (!pathTraced && !this.meshPass.renderPrimitivePass(
      device,
      commandEncoder,
      this.sceneView,
      this.sceneDepthView,
      transparentMeshes,
      camera,
      effectors,
      lightLayers,
      this.modelRuntimeCache,
      temporaryBuffers,
      true,
      strandShadows.receiver,
    )) {
      return null;
    }

    // Slit Scan retains source alpha. Composite after opaque geometry so its
    // translucent pixels reveal the scene already rendered behind the surface.
    for (const layer of sortBySceneLayerDepth([...(pathTraced ? [] : transparentPlanes), ...readySurfaces], camera)) {
      if (layer.slitScanGeometry && this.geometrySurfaces.hasDraw(layer.layerId)) {
        this.geometrySurfaces.render(device, commandEncoder, this.sceneView, this.sceneDepthView, temporaryBuffers, camera.viewport, layerSpaceEffects, layer.layerId);
      } else if (!this.planePass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, [layer], camera, true, temporaryBuffers, maskTextureManager, effectedTextureViews)) {
        return null;
      }
    }
    if (!this.flockPass.render(device, commandEncoder, this.sceneView, this.sceneDepthView, flockPlans, camera, 'transparent', temporaryBuffers,
      pathTraced)) return null;
    if (strandPlans.some(plan => plan.layer.strands.program.render?.wake)) {
      (this.curveWake ??= new CurveWakePass()).render(device, commandEncoder, this.sceneView, this.sceneDepthView,
        strandPlans, camera, temporaryBuffers);
    }
    if (strandPlans.some(plan => plan.layer.strands.program.render?.labels)) {
      (this.curveLabels ??= new CurveLabelPass()).render(device, commandEncoder, this.sceneView, this.sceneDepthView,
        strandPlans, camera, layerSpaceEffects?.timelineTimeSeconds ?? 0, temporaryBuffers);
    }
    const gizmoLayer = gizmo
      ? [...planeLayers, ...voxelLayers, ...flockLayers, ...strandLayers, ...nativeMeshLayers, ...layers, ...lightLayers].find((layer) => layer.clipId === gizmo.clipId) ??
        (gizmo.worldMatrix && gizmo.worldTransform
          ? {
              clipId: gizmo.clipId,
              worldMatrix: gizmo.worldMatrix,
              worldTransform: gizmo.worldTransform,
            }
          : null)
      : null;
    if (gizmo && !this.gizmoPass.render(
      device,
      commandEncoder,
      this.sceneGizmoView,
      gizmoLayer,
      camera,
      gizmo.mode,
      gizmo.hoveredAxis,
      temporaryBuffers,
      true,
    )) {
      return null;
    }
    if (subSample && resourcesReady) this.rasterSubSamples.accumulate(device, commandEncoder, targetKey, this.sceneTexture, options!.exportFrame!, subSample, temporaryBuffers);
    const focusedView = (this.depthOfField ??= new RasterDepthOfField()).render(
      device, commandEncoder, targetKey, this.sceneView, this.sceneDepthView, camera, engine);
    this.toneMap.render(device, commandEncoder, targetKey, focusedView, this.sceneDisplayView, camera.lens,
      options?.renderSettings?.engine ?? 'raster');
    const readTimings = gpuTimings.resolve(commandEncoder, `render:${targetKey}`);
    device.queue.submit([commandEncoder.finish()]);
    (this.strandIds??=new StrandIdCapture()).remember(targetKey,{device,plans:strandPlans,camera,depth:this.sceneDepthView,time:layerSpaceEffects?.timelineTimeSeconds??0});
    this.pathTrace.afterSubmit(device);
    this.rasterSubSamples.afterSubmit(device);
    this.curveLabels?.afterSubmit();
    readTimings();
    void device.queue.onSubmittedWorkDone()
      .then(() => {
        for (const buffer of temporaryBuffers) {
          buffer.destroy();
        }
      })
      .catch(() => {
        for (const buffer of temporaryBuffers) {
          buffer.destroy();
        }
      });
    return this.sceneDisplayView;
    } finally {
      gpuTimings.cancel(commandEncoder);
    }
  }

}
