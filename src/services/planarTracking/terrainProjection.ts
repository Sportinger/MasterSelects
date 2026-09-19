import type { Effect } from '../../types/effects';
import type { PlanarTrack } from '../../types/planarTracking';
import type { TerrainCamera, TerrainReconstruction } from '../../types/terrainTracking';
import { terrainCameraPoint, terrainProject } from './terrainGeometry';
import { sampleOcclusion } from './surfaceGeometry';
import { retainTerrainMesh } from './immutableTerrainMesh';

export const MAX_TERRAIN_TRIANGLES = 128;
const projectedFrames = new WeakMap<TerrainReconstruction, Map<TerrainCamera, string>>();

export function sampleTerrainCamera(terrain: TerrainReconstruction, time: number): TerrainCamera | null {
  if(!Number.isFinite(time))return null;
  // Portable camera timestamps are rounded to microseconds; decoded VideoFrame
  // timestamps may truncate the same rational PTS. Accept that one-unit identity
  // difference without extending coverage to a different source frame.
  const epsilon=terrain.solver==='colmap-openmvs'?1.1e-6:0.6e-6;
  let lo=0,hi=terrain.cameras.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(terrain.cameras[m].time<=time+epsilon)lo=m+1;else hi=m;}
  const camera=terrain.cameras[lo-1];
  return camera&&time<camera.time+camera.duration-epsilon?camera:null;
}

/** Screen positions plus reference-projector homogeneous coordinates divided by current camera depth. */
export function projectTerrainTriangles(terrain: TerrainReconstruction, camera: TerrainCamera): number[] {
  const points=terrain.vertices.map(vertex=>{
    const p=terrainCameraPoint(camera,vertex.position), xy=terrainProject(terrain.intrinsics,p);
    return {p,xy,uvq:vertex.uvq};
  });
  const result:number[]=[];
  for(let i=0;i+2<terrain.triangles.length&&result.length<MAX_TERRAIN_TRIANGLES*24;i+=3) {
    const p=terrain.triangles.slice(i,i+3).map(index=>points[index]);
    if(p.some(v=>!v||v.p[2]<=1e-6||!v.xy.every(Number.isFinite)))continue;
    const area=(p[1].xy[0]-p[0].xy[0])*(p[2].xy[1]-p[0].xy[1])-(p[1].xy[1]-p[0].xy[1])*(p[2].xy[0]-p[0].xy[0]);
    if(Math.abs(area)<1e-9)continue;
    if(p.every(v=>v.xy[0]<0)||p.every(v=>v.xy[0]>1)||p.every(v=>v.xy[1]<0)||p.every(v=>v.xy[1]>1))continue;
    for(const v of p)result.push(v.xy[0],v.xy[1],1/v.p[2],0,...v.uvq.map(value=>value/v.p[2]),0);
  }
  return result;
}

export function terrainEffectForFrame(track: PlanarTrack,time:number): Effect | null {
  const terrain=track.terrain;if(!terrain||!track.enabled)return null;
  const camera=sampleTerrainCamera(terrain,time);
  if(!camera||camera.time<track.visibleFrom||camera.time>track.visibleTo)return null;
  if(terrain.denseMesh){
    retainTerrainMesh(terrain.denseMesh);
    terrain.footsteps?.forEach(step=>{if(step.mesh)retainTerrainMesh(step.mesh);});
    return {id:`surface:${track.id}`,type:'terrain-overlay',name:track.name,enabled:true,params:{},terrainRender:{track,camera}};
  }
  let cache=projectedFrames.get(terrain);if(!cache){cache=new Map();projectedFrames.set(terrain,cache);}
  let mesh=cache.get(camera);if(!mesh){mesh=JSON.stringify(projectTerrainTriangles(terrain,camera));cache.set(camera,mesh);}
  const fade=track.fade>0?Math.max(0,Math.min(1,(camera.time-track.visibleFrom)/track.fade,(track.visibleTo-camera.time)/track.fade)):1;
  const params:Effect['params']={mesh,color:track.color,opacity:track.opacity*fade,fill:track.fill,lineWidth:track.lineWidth,inset:track.inset,shape:track.shape,wireframe:track.showMesh??false};
  const occlusion=sampleOcclusion(track,camera.time);params.occluded=!!occlusion;
  occlusion?.forEach((p,i)=>{params[`ox${i}`]=p.x;params[`oy${i}`]=p.y;});
  return {id:`surface:${track.id}`,type:'terrain-overlay',name:track.name,enabled:true,params};
}
