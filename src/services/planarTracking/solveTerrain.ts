import type { SurfaceQuad } from '../../types/planarTracking';
import { solveScanCameras } from '../photogrammetry/cameraSolvingRuntime';
import { buildTerrainModel } from './terrainModel';
import { openSurfaceFrames, surfaceFrameIndex, type SurfaceFrameStamp } from './surfaceFrameReader';
import { validQuad } from './surfaceGeometry';

export async function solveTerrain(request: {
  url: string; file?: Blob; from: number; to: number; referenceTime: number;
  quad: SurfaceQuad; signal: AbortSignal; onProgress: (message: string) => void;
}) {
  if(!validQuad(request.quad))throw new Error('Choose four non-crossing surface corners before solving.');
  const reader=await openSurfaceFrames(request.url,request.signal,request.file);
  const files:File[]=[], stamps:SurfaceFrameStamp[]=[];
  try {
    const count=Math.max(0,surfaceFrameIndex(reader.frames,request.to))-Math.max(0,surfaceFrameIndex(reader.frames,request.from))+1;
    if(count<8||count>180)throw new Error(`Choose a range containing 8–180 source frames (this range has ${count}).`);
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d');
    if(!context)throw new Error('The frame extraction canvas is unavailable.');
    for await(const frame of reader.readRange(request.from,request.to,181)) {
      request.signal.throwIfAborted();
      canvas.width=frame.pixels.width;canvas.height=frame.pixels.height;context.putImageData(frame.pixels,0,0);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Frame encoding failed.')),'image/jpeg',.95));
      files.push(new File([blob],`frame-${String(files.length).padStart(5,'0')}.jpg`,{type:'image/jpeg'}));
      stamps.push({time:frame.time,duration:frame.duration});
      request.onProgress(`Reading source frames ${files.length}/${count}`);
    }
  } finally {reader.close();}
  request.signal.throwIfAborted();
  const controller=solveScanCameras(files,'Ground camera solve',960,progress=>request.onProgress(progress.message));
  const cancel=()=>controller.cancel();request.signal.addEventListener('abort',cancel,{once:true});
  try {
    const dataset=await controller.result;request.signal.throwIfAborted();
    request.onProgress('Checking camera reprojection and building the ground mesh');
    return buildTerrainModel(dataset.model,stamps,request.referenceTime,request.quad);
  } finally {request.signal.removeEventListener('abort',cancel);}
}
