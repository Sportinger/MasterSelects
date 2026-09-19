import type { EffectDefinition } from '../types';
import shader from './terrainOverlay.wgsl?raw';

const MAX_TRIANGLES=128;
const geometryCache=new Map<string,number[]>();

export const terrainOverlay:EffectDefinition={
  internal:true,id:'terrain-overlay',name:'3D Surface Projection',category:'tracking',shader,
  entryPoint:'terrainOverlayFragment',uniformSize:(20+MAX_TRIANGLES*24)*4,params:{},
  packUniforms(params,width,height){
    const key=String(params.mesh??'[]');let mesh=geometryCache.get(key);
    if(!mesh){
      try{const parsed:unknown=JSON.parse(key);if(!Array.isArray(parsed)||parsed.length>MAX_TRIANGLES*24||parsed.length%24||!parsed.every(v=>typeof v==='number'&&Number.isFinite(v)))return null;mesh=parsed;}
      catch{return null;}
      if(geometryCache.size>=16)geometryCache.delete(geometryCache.keys().next().value!);geometryCache.set(key,mesh);
    }
    const hex=/^#[0-9a-f]{6}$/i.test(String(params.color))?String(params.color):'#ff3535';
    const color=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const data=new Float32Array(20+MAX_TRIANGLES*24);
    data.set([...color,Number(params.opacity??1),width,height,Number(params.lineWidth??3),Number(params.fill??.12),Number(params.inset??0),params.shape==='ellipse'?1:params.shape==='cross'?2:0,params.wireframe?1:0,mesh.length/24,
      ...Array.from({length:4},(_,i)=>[Number(params[`ox${i}`]??0),Number(params[`oy${i}`]??0)]).flat()]);
    // Negative count is not used; an empty occlusion quad naturally covers no area.
    if(!params.occluded)data.fill(-2,12,20);
    data.set(mesh,20);return data;
  },
};
