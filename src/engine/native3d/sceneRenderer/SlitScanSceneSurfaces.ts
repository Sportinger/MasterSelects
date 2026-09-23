import { GeometryQueryOutput } from '../../../effects/time/slit-scan/GeometryQueryOutput';
import { GeometryAgeField } from '../../../effects/time/slit-scan/GeometryAgeField';
import { createSlitScanReference, readSlitScanReference } from '../../../effects/time/slit-scan/geometryReference';
import { slitScanMeshColumns } from '../../../effects/time/slit-scan/geometryParameters';
import type { SlitScanGeometryCapture } from '../../../effects/time/slit-scan/geometryCapture';
import type { SceneCamera, ScenePlaneLayer } from '../../scene/types';
import { SlitScanSurfacePass, type SlitScanSurfaceDraw } from '../passes/SlitScanSurfacePass';
import { buildPlaneMvp } from './planeUniforms';
import { BandTrajectoryField } from '../../../effects/time/slit-scan/BandTrajectoryField';
import { MotionSurfaceField } from '../../../effects/time/slit-scan/MotionSurfaceField';
import { temporalSourceTime } from '../../../effects/time/temporalClipSource';
import { isCollectingTemporalPreparations, setTemporalStatus } from '../../../effects/time/temporalResourcePreparation';
import { TemporalPreviewFrames } from '../../../effects/time/TemporalPreviewFrames';
import type { SlitScanGeometryFrame } from '../../../effects/time/slit-scan/geometryContract';
import { SlitScanProjectedEffects } from '../passes/SlitScanProjectedEffects';
import type { LayerSpaceEffectContext } from './LayerSpaceEffectRenderer';

interface SurfaceOwner { device: GPUDevice; query: GeometryQueryOutput; motion: GeometryQueryOutput; age: GeometryAgeField;
  band: BandTrajectoryField; surface?: MotionSurfaceField; color: TemporalPreviewFrames; lastDraw?: SlitScanSurfaceDraw; lastFrame?: SlitScanGeometryFrame; target: string }

/** Device resources are scoped to a scene target and layer, never durable data. */
export class SlitScanSceneSurfaces {
  private owners = new Map<string, SurfaceOwner>();
  private pass = new SlitScanSurfacePass();
  private draws = new Map<string, SlitScanSurfaceDraw>();
  private projectedEffects = new SlitScanProjectedEffects();
  private activeLayers = new Map<string, ScenePlaneLayer>();
  private target = '';

  hasDraw(layerId: string): boolean { return this.draws.has(layerId); }

  begin(target: string, active: readonly ScenePlaneLayer[], camera: SceneCamera, device: GPUDevice): void {
    this.draws.clear();
    this.target = target;
    this.activeLayers = new Map(active.map(layer => [layer.layerId, layer]));
    const keys = new Set(active.map(layer => JSON.stringify([target, layer.layerId])));
    for (const [key, owner] of this.owners) if (owner.target === target && !keys.has(key)) this.release(key, owner);
    if (!isCollectingTemporalPreparations()) for (const layer of active) {
      const owner = this.owners.get(JSON.stringify([target, layer.layerId]));
      const previous = owner?.device === device ? owner.lastDraw : undefined;
      if (previous) this.draws.set(layer.layerId, { ...previous, mvp: buildPlaneMvp(layer, camera) });
    }
  }

  capture(target: string, layer: ScenePlaneLayer, camera: SceneCamera, frame: SlitScanGeometryCapture): void {
    if (!layer.slitScanGeometry || frame.effect.id !== layer.slitScanGeometry.id) return;
    if (!frame.source) throw new Error('Slit Scan 3D requires a source video.');
    const samplerId = String(frame.effect.params.geometrySampler ?? '').trim();
    if (!samplerId || !frame.graph.nodes.some(node => node.id === samplerId && node.operator === 'image.sample-history')) {
      const message = 'Select an explicit Slit Scan geometry base sampler.';
      setTemporalStatus(`${frame.effect.id}:geometry`, message);
      if (isCollectingTemporalPreparations()) throw new Error(message);
      this.draws.delete(layer.layerId);
      return;
    }
    const key = JSON.stringify([target, layer.layerId]);
    let owner = this.owners.get(key);
    if (!owner || owner.device !== frame.device) {
      if (owner) this.release(key, owner);
      owner = { device: frame.device, query: new GeometryQueryOutput(), motion: new GeometryQueryOutput(),
        age: new GeometryAgeField(frame.device), band: new BandTrajectoryField(frame.device),
        color: new TemporalPreviewFrames(frame.device), target };
      this.owners.set(key, owner);
    }
    const params = frame.effect.params;
    const historyId = frame.historyResources.find(resource => resource.owner === samplerId && resource.part === 'ages')?.id;
    const sampling = historyId ? frame.resources.get(historyId) : undefined;
    const sampledTime = params.geometryTimeBasis === 'samples';
    if (sampledTime && !sampling?.temporalSamples) {
      const message = 'Sampled time geometry requires source-frame history metadata.';
      setTemporalStatus(`${frame.effect.id}:geometry`, message);
      if (isCollectingTemporalPreparations()) throw new Error(message);
      this.draws.delete(layer.layerId);
      return;
    }
    const query = owner.query.capture(frame, String(params.geometrySampler ?? ''));
    if (!query) return;
    let flowDepth = Number(params.geometryFlowDepth ?? 0);
    const isBand = params.geometryMode === 'motion-band';
    const isMotionSurface = params.geometryMode === 'motion-surface';
    const needsTrajectory = isBand || isMotionSurface;
    const uvEdge = frame.graph.edges.find(edge => edge.to === params.geometrySampler && edge.input === 'uv');
    const aligned = frame.graph.nodes.some(node => node.id === uvEdge?.from && node.operator === 'image.normalized-uv');
    const unsupported = (flowDepth !== 0 || needsTrajectory) && !aligned;
    if (unsupported) {
      if (needsTrajectory || isCollectingTemporalPreparations()) throw new Error('Flow geometry requires an image-aligned base sampler.');
      flowDepth = 0;
    }
    const motion = flowDepth !== 0 || needsTrajectory ? owner.motion.capture(frame, String(params.geometrySampler ?? ''), true) : undefined;
    if ((flowDepth !== 0 || needsTrajectory) && !motion) {
      setTemporalStatus(`${frame.effect.id}:geometry`, owner.lastDraw ? 'Preparing geometry motion…' : 'Preparing motion · showing flat image…'); return;
    }
    const projection = params.geometryProjection === 'orthographic' ? 'orthographic' : 'perspective';
    const reference = readSlitScanReference(params.geometryReference) ?? createSlitScanReference(projection);
    const columns = slitScanMeshColumns(params.geometryQuality);
    const rows = Math.max(1, Math.min(Math.max(288, Math.min(512, columns)), Math.round(columns * frame.height / frame.width)));
    let band: GPUTextureView | undefined;
    if (isBand) {
      const angle = Number(params.angle ?? 0);
      if (String(params.profile ?? 'linear') !== 'linear' || ![0,90,-90,180].includes(angle) || Number(params.mapAmount ?? 0) !== 0) {
        throw new Error('Motion bands require a cardinal linear scan without a time map or wave.');
      }
    }
    if (needsTrajectory && !owner.motion.trajectory) throw new Error('Bidirectional DIS correspondences are unavailable.');
    // Validate first: a rejected frame must not overwrite the field belonging
    // to the last complete color/geometry pair still shown in preview.
    const geometry = owner.age.encode(frame.encoder, query, frame.width, frame.height, frame.source,
      Number(params.timeFactor ?? 1), motion, flowDepth, Number(params.geometrySmoothing ?? 0),
      sampledTime ? sampling!.temporalSamples : undefined);
    if (isBand) {
      const angle = Number(params.angle ?? 0);
      band = owner.band.encode(frame.encoder, owner.motion.trajectory!, geometry,
        temporalSourceTime(frame.source, frame.source.localTime), columns, rows, Math.abs(angle) === 90);
    }
    if (isMotionSurface) {
      band = (owner.surface ??= new MotionSurfaceField(frame.device)).encode(frame.encoder, owner.motion.trajectory!, geometry,
        temporalSourceTime(frame.source, frame.source.localTime), columns, rows, Number(params.geometryMotionAmount ?? 1),
        params.geometryMotionGaps !== 'cut');
    }
    owner.color.capture('complete', frame.encoder, frame.color, frame.width, frame.height);
    const draw = { mvp: buildPlaneMvp(layer, camera), reference: new Float32Array(reference.viewProjection),
      inverseReference: new Float32Array(reference.inverseViewProjection), color: owner.color.get('complete', frame.width, frame.height)!, geometry,
      columns, rows, timeDepth: Number(params.geometryTimeDepth ?? .25), opacity: layer.opacity, band };
    owner.lastDraw = draw; this.draws.set(layer.layerId, draw);
    const identity = JSON.stringify([frame.scopeId, frame.effect.id, frame.graph, params, frame.source,
      frame.timelineTime, frame.width, frame.height, [...frame.resources].map(([id, resource]) => [id, resource.identity])]);
    owner.lastFrame = { identity, ownerId: key, outputTime: frame.timelineTime, baseSamplerId: String(params.geometrySampler),
      source: frame.source, timeFactor: Number(params.timeFactor ?? 1), color: draw.color, query,
      contributions: sampling?.view ?? query,
      sampling: sampling?.temporalSamples ?? { interpolation: 'nearest', samples: [{ delay: 0, currentInput: true, contributions: [] }] },
      ...(motion ? { motion: { field: motion, analysisIdentity: owner.motion.trajectory?.identity ?? identity,
        coordinates: params.stabilizationEnabled !== false && params.stabilizationAssetId ? 'stabilized-reference' as const : 'source' as const,
        velocityUnit: 'uv-per-graph-delay-second' as const } } : {}),
    };
    setTemporalStatus(`${frame.effect.id}:geometry`, unsupported
      ? 'Time surface only: custom UV mapping is not supported for flow deformation.'
      : isMotionSurface ? 'Motion surface · ready' : isBand ? 'Motion band · ready' : sampledTime ? 'Sampled time surface · ready' : 'Time surface · ready');
  }

  render(device: GPUDevice, encoder: GPUCommandEncoder, color: GPUTextureView, depth: GPUTextureView, temporary: GPUBuffer[],
    viewport: { width: number; height: number }, context?: LayerSpaceEffectContext, onlyLayerId?: string): void {
    for (const [id, draw] of this.draws) {
      if (onlyLayerId && id !== onlyLayerId) continue;
      const layer = this.activeLayers.get(id);
      const key = JSON.stringify([this.target, id]);
      if (layer?.postProjectionEffects?.length) {
        if (!context) throw new Error('Slit Scan projected effects require the effects pipeline.');
        this.projectedEffects.render(key, device, encoder, color, depth, viewport.width, viewport.height, layer, draw, context, temporary);
      } else {
        this.projectedEffects.release(key);
        this.pass.render(device, encoder, color, depth, [draw], temporary);
      }
    }
  }

  releaseTarget(target: string): void {
    for (const [key, owner] of this.owners) if (owner.target === target) this.release(key, owner);
  }

  destroy(): void {
    for (const [key, owner] of this.owners) this.release(key, owner);
    this.pass.dispose(); this.draws.clear();
    this.projectedEffects.destroy(); this.activeLayers.clear();
  }

  private release(key: string, owner: SurfaceOwner): void {
    this.projectedEffects.release(key);
    owner.query.destroy(); owner.motion.destroy(); owner.age.destroy(); owner.band.destroy(); owner.surface?.destroy(); owner.color.destroy(); this.owners.delete(key);
  }
}
