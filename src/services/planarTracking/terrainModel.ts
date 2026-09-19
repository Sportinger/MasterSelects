import type { SolvedCameraModel } from '../photogrammetry/cameraSolvingContract';
import type { SurfaceFrameStamp } from './surfaceFrameReader';
import type { SurfaceQuad } from '../../types/planarTracking';
import type { TerrainCamera, TerrainIntrinsics, TerrainReconstruction, TerrainVector, TerrainVertex } from '../../types/terrainTracking';
import { inverseMatrix, quadMatrix } from './surfaceGeometry';
import { terrainCameraPoint, terrainMedian, terrainProject, terrainRotation, triangulateTerrain } from './terrainGeometry';

interface ModelPoint { position: TerrainVector; error: number; images: Set<number> }
interface ModelView { id: number; camera: TerrainCamera; points: number[] }

/** Consume the existing solver's COLMAP text without smoothing or inventing missing poses. */
export function buildTerrainModel(model: SolvedCameraModel, stamps: readonly SurfaceFrameStamp[], referenceTime: number, quad: SurfaceQuad): TerrainReconstruction {
  const cameraLine=model.camerasText.split(/\r?\n/).find(l=>l.trim()&&!l.startsWith('#'))?.trim().split(/\s+/);
  if (!cameraLine || cameraLine[1]!=='SIMPLE_PINHOLE') throw new Error('The terrain solver requires a pinhole camera model.');
  const k: TerrainIntrinsics={width:Number(cameraLine[2]),height:Number(cameraLine[3]),fx:Number(cameraLine[4]),fy:Number(cameraLine[4]),cx:Number(cameraLine[5]),cy:Number(cameraLine[6])};
  if (!Object.values(k).every(Number.isFinite)||k.fx<=0||k.width<=0||k.height<=0) throw new Error('Invalid solved camera intrinsics.');
  const points=new Map<number,ModelPoint>();
  for(const line of model.pointsText.split(/\r?\n/)) {
    if(!line.trim()||line.startsWith('#'))continue;
    const v=line.trim().split(/\s+/).map(Number);
    if(v.length<12||!v.every(Number.isFinite)||v[7]>3)continue;
    const images=new Set(v.slice(8).filter((_,i)=>i%2===0));
    if(images.size>=3)points.set(v[0],{position:[v[1],v[2],v[3]],error:v[7],images});
  }
  const views: ModelView[]=[];
  const lines=model.imagesText.split(/\r?\n/).filter(l=>!l.trim().startsWith('#'));
  for(let i=0;i<lines.length;i++) {
    if(!lines[i].trim())continue;
    const v=lines[i].trim().split(/\s+/); const observations=(lines[++i]??'').trim().split(/\s+/).map(Number);
    const id=Number(v[0]), sourceIndex=model.registeredSourceIndices[id-1], stamp=stamps[sourceIndex];
    if(v.length<10||!stamp)continue;
    const values=v.slice(1,8).map(Number); if(!values.every(Number.isFinite))continue;
    const camera: TerrainCamera={...stamp,rotation:terrainRotation(values.slice(0,4)),translation:values.slice(4,7) as TerrainVector,error:0,observations:0};
    const errors: number[]=[], ids: number[]=[];
    for(let j=0;j+2<observations.length;j+=3) {
      const point=points.get(observations[j+2]); if(!point)continue;
      const p=terrainCameraPoint(camera,point.position); if(p[2]<=1e-6)continue;
      const xy=terrainProject(k,p), error=Math.hypot(xy[0]*k.width-observations[j],xy[1]*k.height-observations[j+1]);
      if(error<=4){errors.push(error);ids.push(observations[j+2]);}
    }
    camera.error=terrainMedian(errors);camera.observations=errors.length;
    if(errors.length>=12&&camera.error<=2.5)views.push({id,camera,points:ids});
  }
  const reference=views.find(view=>Math.abs(view.camera.time-referenceTime)<1e-6);
  if(!reference)throw new Error('The chosen reference frame did not solve reliably. Choose a clearer frame with camera translation.');
  if(views.length<8)throw new Error('Too few reliable 3D camera poses. Try a shorter range with textured ground and camera translation.');
  const projector=inverseMatrix(quadMatrix(quad));
  if(!projector)throw new Error('The surface corners are invalid.');
  const candidates=reference.points.map(id=>points.get(id)!).map(point=>{
    const p=terrainCameraPoint(reference.camera,point.position), xy=terrainProject(k,p);
    const clip=[xy[0]*p[2],xy[1]*p[2],p[2]];
    const uvq=Array.from({length:3},(_,i)=>projector[i*3]*clip[0]+projector[i*3+1]*clip[1]+projector[i*3+2]*clip[2]) as TerrainVector;
    return {point,depth:p[2],uvq,uv:[uvq[0]/uvq[2],uvq[1]/uvq[2]] as [number,number]};
  }).filter(p=>p.uvq[2]>0&&p.uv.every(v=>Number.isFinite(v)&&v>=-.12&&v<=1.12)).toSorted((a,b)=>a.point.error-b.point.error);
  const selected: typeof candidates=[];
  // At most 72 supported vertices; no flat-grid fill for regions lacking observations.
  for(const candidate of candidates) {
    if(selected.every(p=>Math.hypot(p.uv[0]-candidate.uv[0],p.uv[1]-candidate.uv[1])>.085))selected.push(candidate);
    if(selected.length>=72)break;
  }
  if(selected.length<12)throw new Error(`Only ${selected.length} reliable 3D points in this surface. Enlarge it or choose a more textured reference frame.`);
  const indices=triangulateTerrain(selected.map(p=>p.uv)), triangles:number[]=[];
  for(let i=0;i<indices.length;i+=3) {
    const t=indices.slice(i,i+3), p=t.map(index=>selected[index]);
    const maxEdge=Math.max(...p.map((a,j)=>Math.hypot(a.uv[0]-p[(j+1)%3].uv[0],a.uv[1]-p[(j+1)%3].uv[1])));
    if(maxEdge>.55 || Math.max(...p.map(a=>a.depth))/Math.min(...p.map(a=>a.depth))>1.6)continue;
    triangles.push(...t); if(triangles.length>=128*3)break;
  }
  if(triangles.length<24)throw new Error('The 3D points do not form a sufficiently connected surface. Try another reference area.');
  const vertices:TerrainVertex[]=selected.map(p=>({position:p.point.position,uvq:p.uvq}));
  return {version:1,solver:'browser-sfm',referenceTime,intrinsics:k,cameras:views.map(v=>v.camera).toSorted((a,b)=>a.time-b.time),vertices,triangles,sourceFrameCount:stamps.length,sparsePointCount:points.size,medianError:terrainMedian(views.map(v=>v.camera.error))};
}
