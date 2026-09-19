import type { Layer } from '../../types/layers';
import type { TimelineClip } from '../../types/timeline';
import type { TerrainAttachment } from '../../types/terrainAttachment';
import { useTrackingStore } from '../../stores/trackingStore';
import { getCanvasContentBounds } from '../canvasContentBounds';
import { defaultTerrainPlacement } from './terrainPlacement';
import { getTerrainSurfaceReconstruction } from './terrainSurfaceMesh';

function getTrackingAsset(assetId: string) {
  return useTrackingStore.getState().assets.find((asset) => asset.id === assetId);
}

function sourcePresentedTime(clip: TimelineClip, timelineTime: number | undefined): number | undefined {
  const binding = clip.trackingBinding;
  if (!binding || binding.targetVideoClipId || timelineTime === undefined) return undefined;
  const start = binding.sourceStart ?? getTrackingAsset(binding.assetId)?.track.referenceTime;
  return start === undefined ? undefined : start + Math.max(0, timelineTime - clip.startTime);
}

function attachmentForBinding(clip: TimelineClip): TerrainAttachment | undefined {
  const binding = clip.trackingBinding;
  const asset = binding ? getTrackingAsset(binding.assetId) : undefined;
  const terrain = asset?.track.terrain
    ? getTerrainSurfaceReconstruction(asset.track.terrain)
    : undefined;
  const mesh = terrain?.denseMesh ?? terrain?.footsteps?.find((step) => step.mesh)?.mesh;
  if (!binding || !asset || !mesh) return undefined;
  return {
    version: 1,
    targetVideoClipId: binding.targetVideoClipId ?? '',
    trackId: asset.track.id,
    placement: binding.placement ?? defaultTerrainPlacement(mesh),
    visible: true,
  };
}

/** Resolve durable links in their owning composition, identically for preview/export. */
export function bindTerrainLayer(
  layer: Layer,
  clip: TimelineClip,
  clips: readonly TimelineClip[],
  timelineTime?: number,
): Layer {
  if (!clip.trackingBinding) {
    for (const [kind, attachment] of [
      ['projection', clip.terrainAttachment],
      ['screen', clip.terrainScreenAnchor?.attachment],
    ] as const) {
      if (!attachment) continue;
      const terrain = clips.find(candidate => candidate.id === attachment.targetVideoClipId)
        ?.planarTracks?.find(track => track.id === attachment.trackId)?.terrain;
      if (!terrain) { layer.visible = false; continue; }
      if (kind === 'projection') layer.terrainProjection = { attachment, terrain };
      else layer.terrainScreenAnchor = { anchor: clip.terrainScreenAnchor!, terrain };
    }
  }
  if (clip.terrainAnchorConnector) {
    const stroke = layer.source?.motion?.appearance?.items.find(item => item.kind === 'stroke' && item.visible);
    const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
    layer.terrainAnchorConnector = stroke?.kind === 'stroke' ? {
      ...clip.terrainAnchorConnector,
      color: `#${channel(stroke.color.r)}${channel(stroke.color.g)}${channel(stroke.color.b)}`,
      width: stroke.width,
      opacity: stroke.opacity * stroke.color.a,
    } : { ...clip.terrainAnchorConnector, opacity: 0 };
  }

  const binding = clip.trackingBinding;
  if (!binding) return layer;
  // Older builders may already have copied native attachment descriptors.
  // A generic binding takes precedence without mutating durable clip data.
  delete layer.terrainProjection;
  delete layer.terrainScreenAnchor;
  const asset = getTrackingAsset(binding.assetId);
  if (!asset) { layer.visible = false; return layer; }
  const presentedTime = sourcePresentedTime(clip, timelineTime);
  if (!binding.targetVideoClipId && presentedTime === undefined) {
    layer.visible = false;
    return layer;
  }
  if (asset.track.terrain) {
    const terrain = getTerrainSurfaceReconstruction(asset.track.terrain);
    const attachment = attachmentForBinding(clip);
    if (!attachment) { layer.visible = false; return layer; }
    if (binding.mode === 'surface') {
      const contentBounds = layer.source?.type === 'text'
        ? getCanvasContentBounds(layer.source.textCanvas)
        : undefined;
      layer.terrainProjection = {
        attachment,
        terrain,
        ...(contentBounds ? { contentBounds } : {}),
        ...(presentedTime === undefined ? {} : { sourcePresentedTime: presentedTime }),
      };
    } else {
      layer.terrainScreenAnchor = {
        anchor: { attachment, offset: { ...binding.offset } },
        terrain,
        ...(presentedTime === undefined ? {} : { sourcePresentedTime: presentedTime }),
      };
    }
  } else if (binding.mode === 'surface') {
    layer.trackingProjection = {
      binding,
      track: asset.track,
      ...(presentedTime === undefined ? {} : { sourcePresentedTime: presentedTime }),
    };
  } else {
    layer.trackingScreenAnchor = {
      binding,
      track: asset.track,
      ...(presentedTime === undefined ? {} : { sourcePresentedTime: presentedTime }),
    };
  }
  return layer;
}
