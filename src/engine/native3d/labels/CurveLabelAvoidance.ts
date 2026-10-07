import common from './curveLabelProjection.wgsl?raw';
import shader from './curveLabelAvoidance.wgsl?raw';

/** A small camera-space soft occupancy field, rebuilt per frame for deterministic seeking/export. */
export class CurveLabelAvoidance {
  private device?:GPUDevice;
  private layout?:GPUBindGroupLayout;
  private occupy?:GPUComputePipeline;
  private arrange?:GPUComputePipeline;
  encode(device:GPUDevice,encoder:GPUCommandEncoder,uniform:GPUBuffer,points:GPUBuffer,pointCount:number,
    count:number,avoidance:number,temporary:GPUBuffer[]):GPUBuffer {
    this.ensure(device);
    const field=device.createBuffer({label:'curve-label-space',size:64*96*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const offsets=device.createBuffer({label:'curve-label-placement',size:count*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    temporary.push(field,offsets);encoder.clearBuffer(field);
    const group=device.createBindGroup({layout:this.layout!,entries:[uniform,points,field,offsets].map((buffer,binding)=>({binding,resource:{buffer}}))});
    if(avoidance>0){
      const scatter=encoder.beginComputePass({label:'curve-label-space'});scatter.setPipeline(this.occupy!);scatter.setBindGroup(0,group);
      scatter.dispatchWorkgroups(Math.ceil(pointCount/64));scatter.end();
    }
    const solve=encoder.beginComputePass({label:'curve-label-placement'});solve.setPipeline(this.arrange!);solve.setBindGroup(0,group);
    solve.dispatchWorkgroups(Math.ceil(count/16));solve.end();return offsets;
  }
  private ensure(device:GPUDevice):void {
    if(this.device===device)return;this.device=device;
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
      {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
      ...[2,3].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage' as const}}))]});
    const module=device.createShaderModule({label:'curve-label-avoidance',code:common+'\n'+shader});
    const pipeline=(entryPoint:string)=>device.createComputePipeline({layout:device.createPipelineLayout({bindGroupLayouts:[this.layout!]}),compute:{module,entryPoint}});
    this.occupy=pipeline('occupy');this.arrange=pipeline('arrange');
  }
  dispose():void{this.device=undefined;this.layout=undefined;this.occupy=undefined;this.arrange=undefined;}
}
