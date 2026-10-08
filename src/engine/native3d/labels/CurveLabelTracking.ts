import {curveLabelFinalUniforms} from './curveLabelFinalTarget';
import type {CurveSet} from '../../../services/operators/geometry/geometryEvaluation';
import type {CurveLabelSpec} from '../../../services/operators/geometry/curveLabels';
import {curveLabelTrackingInputs} from './curveLabelTrackingInputs';
import common from './curveLabelProjection.wgsl?raw';
import shader from './curveLabelTracking.wgsl?raw';

/** Resolve a dozen annotation anchors once, rather than searching curves in every glyph vertex. */
export class CurveLabelTracking {
  private device?:GPUDevice;
  private pipeline?:GPUComputePipeline;
  encode(device:GPUDevice,encoder:GPUCommandEncoder,uniform:GPUBuffer,points:GPUBuffer,
    anchors:GPUBuffer,ranges:GPUBuffer,count:number,temporary:GPUBuffer[]):GPUBuffer {
    if(this.device!==device){
      this.device=device;
      const module=device.createShaderModule({label:'curve-label-tracking',code:common+'\n'+shader});
      this.pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'track'}});
    }
    const output=device.createBuffer({label:'curve-label-tracked-points',size:count*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    temporary.push(output);
    const pass=encoder.beginComputePass({label:'curve-label-tracking'});pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0,device.createBindGroup({layout:this.pipeline!.getBindGroupLayout(0),entries:
      [uniform,points,anchors,output,ranges].map((buffer,binding)=>({binding,resource:{buffer}}))}));
    pass.dispatchWorkgroups(Math.ceil(count/16));pass.end();return output;
  }
  /** Explicit still-frame diagnostic only; ordinary playback never waits for a GPU readback. */
  async capture(device:GPUDevice,points:GPUBuffer,curves:CurveSet,spec:CurveLabelSpec,time:number){
    if(!curves.starts.length)throw new Error('Tracking capture requires curve topology.');
    const inputs=curveLabelTrackingInputs(curves,spec,time),temporary:GPUBuffer[]=[];
    const buffer=(values:Float32Array|Uint32Array,usage:GPUBufferUsageFlags)=>{
      const b=device.createBuffer({size:values.byteLength,usage:usage|GPUBufferUsage.COPY_DST});temporary.push(b);
      device.queue.writeBuffer(b,0,values as Float32Array<ArrayBuffer>);return b;
    };
    const values=new Float32Array(144);values.set([spec.anchorFocus??0,spec.anchorFocusCount??6,spec.anchorFocusAxis??2,0],140);values[63]=spec.count;values[64]=time;values.set(curveLabelFinalUniforms(curves.starts,curves.counts,spec),124);
    values.set([spec.retarget,spec.releaseProgress,spec.followShare,spec.depthSpread],72);values[78]=spec.detachedFocus;
    const read=device.createBuffer({size:spec.count*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=device.createCommandEncoder();
      const output=this.encode(device,encoder,buffer(values,GPUBufferUsage.UNIFORM),points,
        buffer(inputs.anchors,GPUBufferUsage.STORAGE),buffer(inputs.ranges,GPUBufferUsage.STORAGE),spec.count,temporary);
      encoder.copyBufferToBuffer(output,0,read,0,spec.count*16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
      return {...inputs,tracked:new Float32Array(read.getMappedRange()).slice()};
    }finally{read.destroy();temporary.forEach(b=>b.destroy());}
  }
  dispose():void{this.device=undefined;this.pipeline=undefined;}
}
