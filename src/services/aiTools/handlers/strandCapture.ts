import { getNativeSceneRenderer } from '../../../engine/native3d/NativeSceneRenderer';
import { strandIdColors, strandPixelHit, visibleStrandCandidates } from '../../../engine/native3d/passes/strandIdMap';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import { ensureRenderForDiagnostics } from './renderOnce';

export async function handleCaptureStrandMap(args:Record<string,unknown>):Promise<ToolResult> {
  if(typeof args.clipId!=='string'||!args.clipId)return {success:false,error:'Provide a strand clipId.'};
  const samples=args.samples??[];
  if(!Array.isArray(samples)||samples.length>32||samples.some(p=>!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)))
    return {success:false,error:'Provide at most 32 integer x/y pixel samples.'};
  const before=useTimelineStore.getState();
  if(before.isPlaying)return {success:false,error:'Pause playback before capturing strand IDs.'};
  const composition=useMediaStore.getState().activeCompositionId,time=before.playheadPosition;
  try{
    await ensureRenderForDiagnostics();
    const frame=await getNativeSceneRenderer().captureStrandIds(args.clipId,time);
    const after=useTimelineStore.getState();
    if(after.playheadPosition!==time||useMediaStore.getState().activeCompositionId!==composition||after.isPlaying)
      return {success:false,error:'Composition or playhead changed during capture; retry on the desired still frame.'};
    const canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Cannot create strand ID visualization.');
    const image=ctx.createImageData(frame.width,frame.height);image.data.set(strandIdColors(frame));ctx.putImageData(image,0,0);
    return {success:true,data:{clipId:args.clipId,capturedAt:time,width:frame.width,height:frame.height,targetKey:frame.targetKey,
      description:'Hue identifies strand; alternating bands show material position. Read exact u from samples/candidates, not from PNG color. Scene-depth occlusion is included; overlays and post effects are excluded.',
      dataUrl:canvas.toDataURL('image/png'),samples:samples.map(p=>strandPixelHit(frame,p.x,p.y)),candidates:visibleStrandCandidates(frame)}};
  }catch(error){return {success:false,error:error instanceof Error?error.message:String(error)};}
}
