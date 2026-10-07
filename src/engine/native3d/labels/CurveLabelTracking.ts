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
  dispose():void{this.device=undefined;this.pipeline=undefined;}
}
