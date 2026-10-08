import {CurveLabelTracking} from '../labels/CurveLabelTracking';
import {curveLabelLife} from '../labels/curveLabelLayout';
import {multiplyMat4} from '../../scene/SceneTransformUtils';
import type { SceneCamera } from '../../scene/types';
import type { PreparedStrandLayer, StrandPass } from './StrandPass';
import type { StrandIdFrame } from './strandIdMap';
import { SCENE_DEPTH_FORMAT } from '../sceneRenderer/constants';

interface Frame { device:GPUDevice; plans:PreparedStrandLayer[]; camera:SceneCamera; depth:GPUTextureView; time:number }
/** Runtime-only handles of recently presented scenes; no readback or extra draw during normal playback. */
export class StrandIdCapture {
  private frames=new Map<string,Frame>();
  remember(targetKey:string,frame:Frame):void {
    this.frames.delete(targetKey);this.frames.set(targetKey,frame);
    if(this.frames.size>8)this.frames.delete(this.frames.keys().next().value!);
  }
  forget(targetKey:string):void {this.frames.delete(targetKey);}
  clear():void {this.frames.clear();}
  async captureTracking(clipId:string,time:number){
    const entry=[...this.frames].reverse().find(([,frame])=>Math.abs(frame.time-time)<.001&&frame.plans.some(p=>p.layer.clipId===clipId));
    if(!entry)throw new Error('No current main-thread strand frame for this clip/time. Render the requested still frame first.');
    const [targetKey,frame]=entry;const layers=[];const tracker=new CurveLabelTracking();
    try{
      for(const {layer,buffers} of frame.plans.filter(plan=>plan.layer.clipId===clipId)){
        const spec=layer.strands.program.render?.labels;if(!spec)continue;
        if(!buffers.curves)throw new Error('Tracking capture requires curve topology.');
        const snapshot=await tracker.capture(frame.device,buffers.positions,buffers.curves,spec,time);
        const matrix=multiplyMat4(multiplyMat4(frame.camera.projectionMatrix,frame.camera.viewMatrix),layer.worldMatrix);
        const cards=Array.from({length:spec.count},(_,card)=>{
          const point=snapshot.tracked.subarray(card*4,card*4+4);
          const clip=Array.from({length:4},(_,i)=>matrix[i]*point[0]+matrix[i+4]*point[1]+matrix[i+8]*point[2]+matrix[i+12]);
          const reveal=curveLabelLife(spec,time,card).reveal;
          return {card,sourceStrand:snapshot.source[card*4+3],targetStrand:snapshot.destination[card*4+3],
            position:[...point.subarray(0,3)],readiness:point[3],followsReleased:card<Math.round(spec.count*spec.followShare),
            reveal,opacity:spec.opacity*layer.opacity,projected:clip[3]>0?[(clip[0]/clip[3]+1)*frame.camera.viewport.width/2,(1-clip[1]/clip[3])*frame.camera.viewport.height/2]:null};
        });
        layers.push({layerId:layer.layerId,retarget:spec.retarget,releaseProgress:spec.releaseProgress,cards});
      }
      if(!layers.length)throw new Error('This strand clip has no Curve Scan Labels.');
      return {clipId,time,targetKey,width:frame.camera.viewport.width,height:frame.camera.viewport.height,layers};
    }finally{tracker.dispose();}
  }
  async capture(pass:StrandPass,clipId:string,time:number):Promise<StrandIdFrame> {
    const entry=[...this.frames].reverse().find(([,frame])=>Math.abs(frame.time-time)<.001&&frame.plans.some(p=>p.layer.clipId===clipId));
    if(!entry)throw new Error('No current main-thread strand frame for this clip/time. Render the requested frame in the preview first; worker-only scenes are not available to this diagnostic.');
    const [targetKey,frame]=entry,{device,camera}=frame,{width,height}=camera.viewport;
    if(width*height>4194304)throw new Error('Strand ID capture is limited to 4 megapixels; lower preview resolution.');
    const plans=frame.plans.filter(p=>p.layer.clipId===clipId);
    if(plans.some(p=>!p.buffers.curves))throw new Error('Strand ID capture requires curve topology.');
    const layers=plans.map(p=>({clipId:p.layer.clipId,layerId:p.layer.layerId,starts:p.buffers.curves!.starts.slice(),counts:p.buffers.curves!.counts.slice()}));
    const color=device.createTexture({size:[width,height],format:'rgba32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    const depth=device.createTexture({size:[width,height],format:SCENE_DEPTH_FORMAT,usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const bytesPerRow=Math.ceil(width*16/256)*256;
    const read=device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),temporary:GPUBuffer[]=[];
    try{
      const encoder=device.createCommandEncoder();
      pass.renderIds(device,encoder,color.createView(),depth.createView(),frame.depth,plans,camera,temporary);
      encoder.copyTextureToBuffer({texture:color},{buffer:read,bytesPerRow},[width,height]);device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const source=new Uint32Array(read.getMappedRange()),pixels=new Uint32Array(width*height*4);
      for(let y=0;y<height;y++)pixels.set(source.subarray(y*bytesPerRow/4,y*bytesPerRow/4+width*4),y*width*4);
      return {width,height,time:frame.time,targetKey,pixels,layers};
    }finally{read.destroy();color.destroy();depth.destroy();temporary.forEach(b=>b.destroy());}
  }
}
