import { useMemo, useRef, useState } from 'react';
import type { TerrainCamera, TerrainReconstruction, TerrainVector } from '../../../../types/terrainTracking';
import { sampleTerrainCamera } from '../../../../services/planarTracking/terrainProjection';

function center(camera:TerrainCamera):TerrainVector{
  const r=camera.rotation,t=camera.translation;
  return [-r[0]*t[0]-r[3]*t[1]-r[6]*t[2],-r[1]*t[0]-r[4]*t[1]-r[7]*t[2],-r[2]*t[0]-r[5]*t[1]-r[8]*t[2]];
}

/** Inspection only: orbiting this view never modifies the solved camera or decal. */
export function TerrainSceneView({terrain,time}:{terrain:TerrainReconstruction;time:number}){
  const [yaw,setYaw]=useState(35),[tilt,setTilt]=useState(-25);
  const drag=useRef<{x:number;y:number;yaw:number;tilt:number}|null>(null);
  const scene=useMemo(()=>{
    const cameras=terrain.cameras.map(center), all=[...terrain.vertices.map(v=>v.position),...cameras];
    const low=[0,1,2].map(i=>Math.min(...all.map(p=>p[i]))),high=[0,1,2].map(i=>Math.max(...all.map(p=>p[i])));
    const origin=low.map((v,i)=>(v+high[i])/2),radius=Math.max(...high.map((v,i)=>v-low[i]),1e-6);
    const a=yaw*Math.PI/180,b=tilt*Math.PI/180;
    const project=(p:TerrainVector)=>{
      const x=(p[0]-origin[0])/radius,y=(p[1]-origin[1])/radius,z=(p[2]-origin[2])/radius;
      const rx=Math.cos(a)*x+Math.sin(a)*z,rz=-Math.sin(a)*x+Math.cos(a)*z;
      const ry=Math.cos(b)*y-Math.sin(b)*rz, depth=Math.sin(b)*y+Math.cos(b)*rz;
      const scale=720/(3-depth);return {x:160+rx*scale,y:110+ry*scale,z:depth};
    };
    const vertices=terrain.vertices.map(v=>project(v.position)),path=cameras.map(project);
    const faces=Array.from({length:terrain.triangles.length/3},(_,i)=>terrain.triangles.slice(i*3,i*3+3).map(j=>vertices[j])).toSorted((x,y)=>x.reduce((s,v)=>s+v.z,0)-y.reduce((s,v)=>s+v.z,0));
    const active=sampleTerrainCamera(terrain,time),current=active?project(center(active)):null;
    return {faces,path,current};
  },[terrain,time,yaw,tilt]);
  return <div className="surface-scene-view">
    <svg role="img" aria-label="Reconstructed ground mesh and camera trajectory" viewBox="0 0 320 220" style={{width:'100%',background:'#151a20',touchAction:'none',cursor:'grab'}}
      onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,yaw,tilt};}}
      onPointerMove={e=>{const start=drag.current;if(start){setYaw(((start.yaw+(e.clientX-start.x)*.6+180)%360+360)%360-180);setTilt(Math.max(-85,Math.min(85,start.tilt+(e.clientY-start.y)*.6)));}}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      {scene.faces.map((face,i)=><polygon key={i} points={face.map(p=>`${p.x},${p.y}`).join(' ')} fill="#2186a633" stroke="#61cdec" strokeWidth=".65"/>)}
      <polyline points={scene.path.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#eab16e" strokeWidth="1.2"/>
      {scene.path.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="1" fill="#eab16e"/>)}
      {scene.current&&<circle cx={scene.current.x} cy={scene.current.y} r="4" fill="#ff5353" stroke="white"/>}
      <text x="10" y="205" fill="#aab5bf" fontSize="10">Cyan: ground mesh · Amber: camera path</text>
    </svg>
    <label>Orbit <input aria-label="3D mesh orbit" type="range" min="-180" max="180" value={yaw} onChange={e=>setYaw(Number(e.target.value))}/></label>
    <label>Tilt <input aria-label="3D mesh tilt" type="range" min="-85" max="85" value={tilt} onChange={e=>setTilt(Number(e.target.value))}/></label>
  </div>;
}
