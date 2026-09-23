import { sourceFrameService } from '../mediaRuntime/sourceFrames/SourceFrameService';
import type { SourceFrameAsset } from '../mediaRuntime/sourceFrames/SourceFrameReader';
import type { SurfaceDecodedFrame } from '../planarTracking/surfaceFrameReader';

/** Bounded CPU adapter: pixels are copied synchronously while the shared frame is borrowed. */
export async function openObjectFrames(asset: SourceFrameAsset, signal: AbortSignal) {
  const lease=sourceFrameService.acquire(asset);
  const abort=()=>lease.release();signal.addEventListener('abort',abort,{once:true});
  const close=()=>{signal.removeEventListener('abort',abort);lease.release();};
  try {
    signal.throwIfAborted();
    const reader=await lease.ready;signal.throwIfAborted();
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('Could not create object analysis canvas.');
    return {frames:reader.frames,close,async read(time:number):Promise<SurfaceDecodedFrame> {
      signal.throwIfAborted();let result:SurfaceDecodedFrame|undefined;
      await lease.request({times:[time],priority:'required',signal,onFrame:surface=>{
        if('image' in surface)throw new Error('Object tracking requires original frames.');
        const rotation=((surface.rotation%360)+360)%360;
        if(![0,90,180,270].includes(rotation))throw new Error('Unsupported video rotation.');
        const scale=Math.min(1,960/Math.max(surface.width,surface.height));
        canvas.width=Math.max(1,Math.round(surface.width*scale));canvas.height=Math.max(1,Math.round(surface.height*scale));
        context.save();context.translate(canvas.width/2,canvas.height/2);context.rotate(rotation*Math.PI/180);
        const w=rotation%180?canvas.height:canvas.width,h=rotation%180?canvas.width:canvas.height;
        context.drawImage(surface.frame,-w/2,-h/2,w,h);context.restore();
        result={time:surface.time,duration:surface.duration,pixels:context.getImageData(0,0,canvas.width,canvas.height)};
      }});
      if(!result)throw new Error('The requested source frame is missing.');return result;
    }};
  }catch(error){close();throw error;}
}
