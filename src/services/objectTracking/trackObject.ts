import { objectEnclosure } from './objectEnclosure';
import type { SurfacePoint, SurfaceSample } from '../../types/planarTracking';
import type { SourceFrameAsset } from '../mediaRuntime/sourceFrames/SourceFrameReader';
import { surfaceFrameIndex } from '../planarTracking/surfaceFrameReader';
import { contourBounds, validContour } from './objectContour';
import { openObjectFrames } from './objectFrames';

export async function trackObject(request:{asset:SourceFrameAsset;from:number;to:number;contour:SurfacePoint[];detail:SurfacePoint[];padding?:number;signal:AbortSignal;onProgress:(progress:number)=>void;onFrame?:(sample:SurfaceSample,pixels:ImageData)=>void}) {
  if(!validContour(request.contour)||!validContour(request.detail))throw new Error('Adjust the outline so its edges do not cross.');
  const reader=await openObjectFrames(request.asset,request.signal);
  let worker:Worker|undefined;
  try {
    request.signal.throwIfAborted();worker=new Worker('/workers/object-tracking.worker.js');
    const first=Math.max(0,surfaceFrameIndex(reader.frames,request.from)),last=Math.max(0,surfaceFrameIndex(reader.frames,request.to));
    const direction=last>=first?1:-1,count=Math.min(1800,Math.abs(last-first)+1);
    const samples:SurfaceSample[]=[];let stopped:string|undefined;
    for(let i=0;i<count;i++) {
      request.signal.throwIfAborted();
      const frame=await reader.read(reader.frames[first+i*direction].time);
      const preview=request.onFrame?new ImageData(new Uint8ClampedArray(frame.pixels.data),frame.pixels.width,frame.pixels.height):undefined;
      const result=await new Promise<{contour?:SurfacePoint[];detailContour?:SurfacePoint[];confidence:number;lost?:boolean;reason?:string}>((resolve,reject)=>{
        const abort=()=>finish(()=>reject(new DOMException('Tracking cancelled','AbortError')));
        const timer=setTimeout(()=>finish(()=>reject(new Error('Object tracker timed out.'))),30_000);
        const finish=(callback:()=>void)=>{clearTimeout(timer);request.signal.removeEventListener('abort',abort);callback();};
        request.signal.addEventListener('abort',abort,{once:true});
        worker!.onerror=e=>finish(()=>reject(new Error(e.message)));
        worker!.onmessage=({data})=>finish(()=>data.error?reject(new Error(data.error)):resolve(data.data));
        worker!.postMessage({pixels:frame.pixels.data.buffer,width:frame.pixels.width,height:frame.pixels.height,reset:i===0,contour:request.contour,detail:request.detail},[frame.pixels.data.buffer]);
      });
      request.signal.throwIfAborted();
      if(result.lost||!result.contour||!validContour(result.contour)){stopped=`${frame.time.toFixed(3)}s: ${result.reason??'Outline became invalid; correct here and continue.'}`;break;}
      // Rebuild the safety margin from the detailed silhouette every frame;
      // advecting the already padded corners erodes the margin over time.
      const outline=i&&result.detailContour?objectEnclosure(result.detailContour,request.contour.length,request.padding??.1):result.contour;
      samples.push({time:frame.time,duration:frame.duration,quad:contourBounds(outline),contour:outline,detailContour:result.detailContour,confidence:result.confidence});
      request.onProgress((i+1)/count);
      if(preview)request.onFrame?.(samples.at(-1)!,preview);
    }
    if(!stopped&&Math.abs(last-first)+1>count)stopped='Pass limit reached. Continue from the last tracked frame.';
    return {samples:samples.toSorted((a,b)=>a.time-b.time),stopped};
  }finally{worker?.terminate();reader.close();}
}
