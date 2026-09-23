import type { SurfacePoint } from '../../types/planarTracking';
import { maskContour } from './objectContour';

export type ObjectPrompt=SurfacePoint&{label:0|1};
/** A panel owns its worker and cached embeddings; the panel serializes requests. */
export class ObjectSelectionSession {
  private worker:Worker|undefined;
  dispose(){this.worker?.terminate();this.worker=undefined;}
  async select(pixels:ImageData,frameKey:string,points:ObjectPrompt[],signal:AbortSignal,onStatus:(value:string)=>void) {
  signal.throwIfAborted();
  if(!points.some(p=>p.label===1))throw new Error('Click inside the object first, then Ctrl-click areas to exclude.');
  const worker=this.worker??=new Worker(new URL('./objectSelection.worker.ts',import.meta.url),{type:'module'});
  try {
    const result=await new Promise<{mask:Uint8Array;width:number;height:number}>((resolve,reject)=>{
      const stop=()=>finish(()=>reject(new DOMException('Selection cancelled','AbortError')));
      const timer=setTimeout(()=>finish(()=>reject(new Error('Selection timed out. Try again after the model download finishes.'))),180_000);
      const finish=(callback:()=>void)=>{clearTimeout(timer);signal.removeEventListener('abort',stop);callback();};
      signal.addEventListener('abort',stop,{once:true});
      worker.onerror=e=>finish(()=>reject(new Error(e.message||'Selection worker failed.')));
      worker.onmessage=({data})=>{
        if(data.status){onStatus(data.status);return;}
        finish(()=>data.error?reject(new Error(data.error)):resolve(data));
      };
      worker.postMessage({pixels,frameKey,points},[pixels.data.buffer]);
    });
    signal.throwIfAborted();
    const seed=points.find(p=>p.label===1&&result.mask[Math.min(result.height-1,Math.floor(p.y*result.height))*result.width+Math.min(result.width-1,Math.floor(p.x*result.width))]);
    if(!seed)throw new Error('No object remains selected. Add a point inside the subject or undo the last click.');
    return maskContour(result.mask,result.width,result.height,seed);
  }catch(error){this.dispose();throw error;}
  }
}
