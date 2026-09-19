import type { DenseTerrainMesh, TerrainCamera, TerrainPlacement, TerrainReconstruction, TerrainVector } from '../../types/terrainTracking';
import type { SurfacePoint } from '../../types/planarTracking';

const dot=(a:number[],b:number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:number[],b:number[]):TerrainVector=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a:number[],b:number[]):TerrainVector=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const defaultTerrainPlacement=(mesh:DenseTerrainMesh):TerrainPlacement=>({x:0,y:0,width:mesh.size[0],height:mesh.size[1],rotation:0});

/** Raycast the visible pixel against observed triangles, including ground hidden by a shoe in this frame. */
export function pickTerrainPoint(terrain:TerrainReconstruction,camera:TerrainCamera,pixel:SurfacePoint):TerrainVector|null {
  const mesh=terrain.denseMesh;if(!mesh)return null;
  const k=terrain.intrinsics,r=camera.rotation,t=camera.translation;
  const distorted=[(pixel.x*k.width-k.cx)/k.fx,(pixel.y*k.height-k.cy)/k.fy];
  let [x,y]=distorted;
  for(let n=0;n<8;n++){const d=1+(k.k1??0)*(x*x+y*y);x=distorted[0]/d;y=distorted[1]/d;}
  const origin:TerrainVector=[-r[0]*t[0]-r[3]*t[1]-r[6]*t[2],-r[1]*t[0]-r[4]*t[1]-r[7]*t[2],-r[2]*t[0]-r[5]*t[1]-r[8]*t[2]];
  const direction:TerrainVector=[r[0]*x+r[3]*y+r[6],r[1]*x+r[4]*y+r[7],r[2]*x+r[5]*y+r[8]];
  const v=(i:number):TerrainVector=>[mesh.positions[i*3],mesh.positions[i*3+1],mesh.positions[i*3+2]];
  let nearest=Infinity;
  for(let i=0;i<mesh.indices.length;i+=3){
    const a=v(mesh.indices[i]),edge1=sub(v(mesh.indices[i+1]),a),edge2=sub(v(mesh.indices[i+2]),a),p=cross(direction,edge2),det=dot(edge1,p);
    if(Math.abs(det)<1e-10)continue;
    const s=sub(origin,a),u=dot(s,p)/det;if(u<0||u>1)continue;
    const q=cross(s,edge1),w=dot(direction,q)/det;if(w<0||u+w>1)continue;
    const depth=dot(edge2,q)/det;if(depth>1e-6&&depth<nearest)nearest=depth;
  }
  return Number.isFinite(nearest)?origin.map((v,i)=>v+direction[i]*nearest) as TerrainVector:null;
}

export function footprintPlacement(terrain:TerrainReconstruction,camera:TerrainCamera,points:SurfacePoint[]):TerrainPlacement {
  if(points.length<3||points.length>32)throw new Error('Outline the contact area with 3–32 points.');
  const mesh=terrain.denseMesh!;
  const local=points.map(pixel=>{const hit=pickTerrainPoint(terrain,camera,pixel);if(!hit)throw new Error('Part of the footprint has no reconstructed ground. Adjust the outline or use another contact frame.');const delta=sub(hit,mesh.origin);return [dot(delta,mesh.axisX),dot(delta,mesh.axisY)];});
  const low=[0,1].map(i=>Math.min(...local.map(p=>p[i]))),high=[0,1].map(i=>Math.max(...local.map(p=>p[i])));
  const width=high[0]-low[0],height=high[1]-low[1];
  if(width<1e-6||height<1e-6)throw new Error('The contact outline is too small.');
  return {x:(low[0]+high[0])/2,y:(low[1]+high[1])/2,width,height,rotation:0,contactTime:camera.time,contour:local.map(p=>[(p[0]-low[0])/width,(p[1]-low[1])/height])};
}
