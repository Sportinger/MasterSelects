import type { DenseTerrainMesh, TerrainFootstep, TerrainPlacement, TerrainReconstruction, TerrainVector } from '../../types/terrainTracking';
import { retainTerrainMesh } from './immutableTerrainMesh';

const finiteArray=(v:unknown,n?:number):v is number[]=>Array.isArray(v)&&(n===undefined||v.length===n)&&v.every(x=>typeof x==='number'&&Number.isFinite(x));
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid reconstruction object.');return v as Record<string,unknown>;};
export const MAX_TERRAIN_IMPORT_BYTES=100*1024*1024;
const dot=(a:number[],b:number[])=>a.reduce((sum,v,i)=>sum+v*b[i],0);

function parseMesh(value:unknown):DenseTerrainMesh {
  const mesh=object(value);
  if(!finiteArray(mesh.positions)||mesh.positions.length<9||mesh.positions.length%3||mesh.positions.length>3_000_000)throw new Error('Invalid mesh vertices (maximum 1 million).');
  const vertexCount=mesh.positions.length/3;
  if(!finiteArray(mesh.indices)||mesh.indices.length<3||mesh.indices.length%3||mesh.indices.length>6_000_000||!mesh.indices.every(i=>Number.isInteger(i)&&i>=0&&i<vertexCount))throw new Error('Invalid mesh triangles (maximum 2 million).');
  for(const key of ['origin','axisX','axisY','normal'])if(!finiteArray(mesh[key],3))throw new Error('Invalid ground coordinate frame.');
  const axes=['axisX','axisY','normal'].map(key=>mesh[key] as TerrainVector);
  if(axes.some(a=>Math.abs(Math.hypot(...a)-1)>.001)||Math.abs(dot(axes[0],axes[1]))>.001||Math.abs(dot(axes[0],axes[2]))>.001||Math.abs(dot(axes[1],axes[2]))>.001)throw new Error('Ground axes must be orthonormal.');
  if(!finiteArray(mesh.size,2)||mesh.size.some(v=>v<=0))throw new Error('Invalid ground dimensions.');
  return retainTerrainMesh({positions:mesh.positions,indices:mesh.indices,origin:mesh.origin as TerrainVector,axisX:mesh.axisX as TerrainVector,axisY:mesh.axisY as TerrainVector,normal:mesh.normal as TerrainVector,size:mesh.size as [number,number]});
}

function parseFootsteps(value:unknown):TerrainFootstep[]|undefined {
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>500)throw new Error('Invalid footstep sequence (maximum 500).');
  const ids=new Set<string>();let previous=-Infinity;
  return value.map(item=>{
    const step=object(item),p=object(step.placement);
    if(typeof step.id!=='string'||!step.id||ids.has(step.id)||typeof step.name!=='string')throw new Error('Footsteps need unique identifiers and names.');
    ids.add(step.id);
    if(!['x','y','width','height','rotation','contactTime'].every(key=>typeof p[key]==='number'&&Number.isFinite(p[key]))||Number(p.width)<=0||Number(p.height)<=0||Number(p.contactTime)<previous)throw new Error('Invalid footstep placement or contact order.');
    if(!Array.isArray(p.contour)||p.contour.length<3||p.contour.length>32||!p.contour.every(point=>finiteArray(point,2)&&point.every(v=>v>=0&&v<=1)))throw new Error('Invalid footstep contour.');
    if(p.profile!==undefined&&p.profile!=='hiking')throw new Error('Unsupported sole profile.');
    if(p.side!==undefined&&p.side!=='left'&&p.side!=='right')throw new Error('Invalid footstep side.');
    previous=Number(p.contactTime);
    const placement:TerrainPlacement={x:Number(p.x),y:Number(p.y),width:Number(p.width),height:Number(p.height),rotation:Number(p.rotation),contactTime:previous,contour:p.contour as [number,number][],profile:p.profile as TerrainPlacement['profile'],side:p.side as TerrainPlacement['side']};
    return {id:step.id,name:step.name,placement,...(step.mesh?{mesh:parseMesh(step.mesh)}:{})};
  });
}

/** Validate the portable, relative-scale camera/mesh bundle before any store edit. */
export function parseDenseTerrain(text:string,sourceName?:string):TerrainReconstruction {
  if(text.length>MAX_TERRAIN_IMPORT_BYTES)throw new Error('Reconstruction exceeds 100 MB.');
  const bundle=object(JSON.parse(text));
  if(bundle.format!=='masterselects-terrain'||bundle.version!==1)throw new Error('Choose a MasterSelects terrain bundle (.msterrain.json).');
  if(sourceName&&bundle.sourceName!==sourceName)throw new Error(`This reconstruction belongs to ${String(bundle.sourceName)}. Selected source: ${sourceName}.`);
  const t=object(bundle.terrain),k=object(t.intrinsics);
  if(t.version!==1||t.solver!=='colmap-openmvs')throw new Error('Unsupported reconstruction version.');
  const mesh=parseMesh(t.denseMesh),footsteps=parseFootsteps(t.footsteps);
  if(!['width','height','fx','fy','cx','cy'].every(key=>typeof k[key]==='number'&&Number.isFinite(k[key]))||Number(k.width)<=0||Number(k.height)<=0||Number(k.fx)<=0||Number(k.fy)<=0||!Number.isFinite(k.k1??0))throw new Error('Invalid lens calibration.');
  if(!Array.isArray(t.cameras)||!t.cameras.length||t.cameras.length>10000)throw new Error('Invalid camera sequence.');
  let end=-Infinity;
  for(const value of t.cameras){
    const c=object(value);
    // Independently rounded microsecond PTS and durations can overlap by 1 μs.
    if(!finiteArray(c.rotation,9)||!finiteArray(c.translation,3)||!['time','duration','error','observations'].every(key=>typeof c[key]==='number'&&Number.isFinite(c[key]))||Number(c.duration)<=0||Number(c.time)<end-1.1e-6)throw new Error('Invalid or overlapping camera timestamps.');
    if(c.occluders!==undefined&&(!Array.isArray(c.occluders)||c.occluders.length>4||!c.occluders.every(quad=>Array.isArray(quad)&&quad.length===4&&quad.every(point=>finiteArray(point,2)&&point.every(v=>v>=-1&&v<=2)))))throw new Error('Invalid foreground occlusion quads.');
    const r=c.rotation,rows=[r.slice(0,3),r.slice(3,6),r.slice(6,9)];
    const det=r[0]*(r[4]*r[8]-r[5]*r[7])-r[1]*(r[3]*r[8]-r[5]*r[6])+r[2]*(r[3]*r[7]-r[4]*r[6]);
    if(rows.some(a=>Math.abs(Math.hypot(...a)-1)>.001)||Math.abs(dot(rows[0],rows[1]))>.001||Math.abs(dot(rows[0],rows[2]))>.001||Math.abs(dot(rows[1],rows[2]))>.001||Math.abs(det-1)>.001)throw new Error('Invalid camera rotation.');
    end=Number(c.time)+Number(c.duration);
  }
  if(!['referenceTime','sourceFrameCount','sparsePointCount','medianError'].every(key=>typeof t[key]==='number'&&Number.isFinite(t[key])))throw new Error('Missing reconstruction metadata.');
  // Keep only the supported schema; imported data cannot install runtime state.
  return {version:1,solver:'colmap-openmvs',referenceTime:Number(t.referenceTime),intrinsics:{width:Number(k.width),height:Number(k.height),fx:Number(k.fx),fy:Number(k.fy),cx:Number(k.cx),cy:Number(k.cy),k1:Number(k.k1??0)},
    cameras:t.cameras.map(value=>{const c=object(value);return {time:Number(c.time),duration:Number(c.duration),rotation:c.rotation as TerrainReconstruction['cameras'][number]['rotation'],translation:c.translation as TerrainVector,error:Number(c.error),observations:Number(c.observations),...(c.occluders?{occluders:c.occluders as [number,number][][]}:{})};}),
    vertices:[],triangles:[],sourceFrameCount:Number(t.sourceFrameCount),sparsePointCount:Number(t.sparsePointCount),medianError:Number(t.medianError),
    denseMesh:mesh,footsteps};
}
