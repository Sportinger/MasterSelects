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
