import { terrainCameraPoint, terrainProject } from '../../services/planarTracking/terrainGeometry';
import { sampleTerrainCamera } from '../../services/planarTracking/terrainProjection';
import type { Layer } from '../../types/layers';
import type { TrackingSourceTransform } from '../../types/terrainAttachment';
import { resolvePlanarTrackingScreenAnchor } from '../../services/planarTracking/trackingBindingRender';
import {
  IDENTITY_TRACKING_SOURCE_TRANSFORM,
  transformTrackingPoint,
} from '../../services/planarTracking/trackingSourceTransform';

export interface ResolvedTerrainScreenAnchor {
  /** Normalized source-video position of the terrain contact. */
  contact: { x: number; y: number };
  /** Normalized composition position after the authored screen offset. */
  content: { x: number; y: number };
}

const EMPTY_SOURCE_TRANSFORMS = new Map<string, TrackingSourceTransform>();

/** Place opted-in labels together before compositing so connectors use the same result. */
export function resolveTerrainScreenAnchors(
  layers: readonly Layer[],
  displayedMediaTimes: ReadonlyMap<string, number>,
  sourceTransforms?: ReadonlyMap<string, TrackingSourceTransform>,
): Map<string, ResolvedTerrainScreenAnchor> {
  const results=new Map<string,ResolvedTerrainScreenAnchor>();
  const groups=new Map<string,Layer[]>();
  for(const layer of layers){
    const resolved = layer.trackingScreenAnchor
      ? resolvePlanarTrackingScreenAnchor(layer.trackingScreenAnchor, displayedMediaTimes, sourceTransforms ?? EMPTY_SOURCE_TRANSFORMS)
      : resolveTerrainScreenAnchor(layer, displayedMediaTimes, sourceTransforms);
    if(!resolved)continue;
    results.set(layer.id,resolved);
    const layout=layer.terrainScreenAnchor?.anchor.labelLayout;
    if(layout&&layer.opacity>.001){const group=groups.get(layout.group)??[];group.push(layer);groups.set(layout.group,group);}
  }
  for(const group of groups.values()){
    const placed:{x:number;y:number;width:number;height:number}[]=[];
    const top=Math.min(...group.map(layer=>results.get(layer.id)!.contact.y))-.11;
    for(const layer of group.toSorted((a,b)=>results.get(a.id)!.contact.x-results.get(b.id)!.contact.x)){
      const resolved=results.get(layer.id)!,anchor=layer.terrainScreenAnchor!.anchor,layout=anchor.labelLayout!;
      const bounds=anchor.contentBounds??{left:layout.width/2+.02,right:1-layout.width/2-.02,top:.13,bottom:.85};
      let best={...resolved.content},score=Infinity;
      const ceiling=Math.max(bounds.top,Math.min(bounds.bottom,top-layout.height/2));
      for(let row=0;row<8;row++)for(let column=0;column<5;column++){
        const x=column===0?Math.max(bounds.left,Math.min(bounds.right,resolved.contact.x)):
          bounds.left+(bounds.right-bounds.left)*(column-1)/3;
        const y=Math.max(bounds.top,ceiling-row*(layout.height+.014));
        const overlap=placed.reduce((sum,other)=>sum+Math.max(0,(layout.width+other.width)/2+.014-Math.abs(x-other.x))*Math.max(0,(layout.height+other.height)/2+.014-Math.abs(y-other.y)),0);
        const value=overlap*10000+Math.hypot(x-resolved.contact.x,(y-resolved.contact.y)*.7)+row*.003;
        if(value<score){score=value;best={x,y};}
      }
      resolved.content=best;placed.push({...best,width:layout.width,height:layout.height});
    }
  }
  return results;
}

export function resolveTerrainScreenAnchor(
  layer: Layer,
  displayedMediaTimes: ReadonlyMap<string, number>,
  sourceTransforms?: ReadonlyMap<string, TrackingSourceTransform>,
): ResolvedTerrainScreenAnchor | null {
  const descriptor = layer.terrainScreenAnchor;
  if (!descriptor?.anchor.attachment.visible) return null;
  const attachment = descriptor.anchor.attachment;
  // The current displayed PTS identifies the actual video frame. Do not
  // attach native UI to a desired seek time or an uncovered terrain pose.
  const displayedMediaTime = attachment.targetVideoClipId
    ? displayedMediaTimes.get(attachment.targetVideoClipId)
    : descriptor.sourcePresentedTime;
  if (displayedMediaTime === undefined) return null;
  const camera = sampleTerrainCamera(descriptor.terrain, displayedMediaTime);
  const mesh = attachment.footstepId
    ? descriptor.terrain.footsteps?.find(step => step.id === attachment.footstepId)?.mesh
      ?? descriptor.terrain.denseMesh
    : descriptor.terrain.denseMesh;
  if (!camera || !mesh) return null;
  const placement = attachment.placement;
  const world = mesh.origin.map((value, index) => (
    value + mesh.axisX[index] * placement.x + mesh.axisY[index] * placement.y
  )) as [number, number, number];
  const point = terrainCameraPoint(camera, world);
  if (point[2] <= 0) return null;
  const [sourceX, sourceY] = terrainProject(descriptor.terrain.intrinsics, point);
  const sourceTransform = descriptor.sourceTransform
    ?? (attachment.targetVideoClipId
      ? sourceTransforms?.get(attachment.targetVideoClipId)
        ?? (sourceTransforms ? null : IDENTITY_TRACKING_SOURCE_TRANSFORM)
      : IDENTITY_TRACKING_SOURCE_TRANSFORM);
  if (!sourceTransform) return null;
  const contact = transformTrackingPoint(sourceTransform, { x: sourceX, y: sourceY });
  if (!contact || contact.x < 0 || contact.x > 1 || contact.y < 0 || contact.y > 1) return null;
  const content = { x: contact.x + descriptor.anchor.offset.x, y: contact.y + descriptor.anchor.offset.y };
  const bounds = descriptor.anchor.contentBounds;
  if (bounds) {
    content.x = Math.max(bounds.left, Math.min(bounds.right, content.x));
    content.y = Math.max(bounds.top, Math.min(bounds.bottom, content.y));
  }
  if (!Number.isFinite(content.x) || !Number.isFinite(content.y)) return null;
  return { contact, content };
}

export function layerPositionForTerrainScreenAnchor(
  layer: Layer,
  resolved: ResolvedTerrainScreenAnchor,
): Layer {
  return {
    ...layer,
    position: {
      ...layer.position,
      // Keep authored/keyframed 2D placement as a local offset from the
      // tracked contact. The attachment supplies the terrain origin only.
      x: resolved.content.x * 2 - 1 + layer.position.x,
      y: resolved.content.y * 2 - 1 + layer.position.y,
    },
  };
}
