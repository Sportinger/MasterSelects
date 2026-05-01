import type { ClipMask, Layer, MaskVertex, TimelineClip } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { generateMaskTexture } from '../../utils/maskRenderer';
import { engine } from '../WebGPUEngine';

const exportMaskVersions = new Map<string, string>();

function getMaskShapeHash(masks: ClipMask[]): string {
  return masks.map(mask =>
    `${mask.enabled !== false}|${mask.inverted}|${mask.closed}|${mask.mode}|` +
    `${mask.vertices.map((vertex: MaskVertex) => [
      vertex.x.toFixed(4),
      vertex.y.toFixed(4),
      vertex.handleIn.x.toFixed(4),
      vertex.handleIn.y.toFixed(4),
      vertex.handleOut.x.toFixed(4),
      vertex.handleOut.y.toFixed(4),
    ].join(',')).join(';')}|` +
    `${mask.position.x.toFixed(4)},${mask.position.y.toFixed(4)}|` +
    `${(mask.feather || 0).toFixed(2)}|${mask.featherQuality ?? 50}`
  ).join('||');
}

function collectClips(clips: TimelineClip[], clipMap: Map<string, TimelineClip>): void {
  for (const clip of clips) {
    clipMap.set(clip.id, clip);
    if (clip.nestedClips?.length) {
      collectClips(clip.nestedClips, clipMap);
    }
  }
}

function collectMaskClipIds(layers: Layer[], ids: Set<string>): void {
  for (const layer of layers) {
    if (layer.maskClipId) {
      ids.add(layer.maskClipId);
    }
    const nestedLayers = layer.source?.nestedComposition?.layers;
    if (nestedLayers?.length) {
      collectMaskClipIds(nestedLayers, ids);
    }
  }
}

export function syncExportMaskTextures(layers: Layer[], width: number, height: number): void {
  if (layers.length === 0) return;

  const maskClipIds = new Set<string>();
  collectMaskClipIds(layers, maskClipIds);
  if (maskClipIds.size === 0) return;

  const clipMap = new Map<string, TimelineClip>();
  collectClips(useTimelineStore.getState().clips, clipMap);

  for (const clipId of maskClipIds) {
    const clip = clipMap.get(clipId);
    const masks = clip?.masks;
    if (!masks?.some(mask => mask.enabled !== false)) {
      exportMaskVersions.delete(clipId);
      engine.removeMaskTexture(clipId);
      continue;
    }

    const version = `${width}x${height}|${getMaskShapeHash(masks)}`;
    if (exportMaskVersions.get(clipId) === version && engine.hasMaskTexture(clipId)) {
      continue;
    }
    exportMaskVersions.set(clipId, version);

    const maskImageData = generateMaskTexture(masks, width, height);
    if (maskImageData) {
      engine.updateMaskTexture(clipId, maskImageData);
    } else {
      exportMaskVersions.delete(clipId);
      engine.removeMaskTexture(clipId);
    }
  }
}
