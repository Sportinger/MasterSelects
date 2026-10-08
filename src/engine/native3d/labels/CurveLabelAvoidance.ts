import common from './curveLabelProjection.wgsl?raw';
import shader from './curveLabelAvoidance.wgsl?raw';

/** A small camera-space soft occupancy field, rebuilt per frame for deterministic seeking/export. */
export class CurveLabelAvoidance {
  private device?:GPUDevice;
  private layout?:GPUBindGroupLayout;
  private occupy?:GPUComputePipeline;
  private arrange?:GPUComputePipeline;
  private softenX?:GPUComputePipeline;
  private softenY?:GPUComputePipeline;
  encode(device:GPUDevice,encoder:GPUCommandEncoder,uniform:GPUBuffer,points:GPUBuffer,pointCount:number,
    count:number,avoidance:number,presence:Float32Array<ArrayBuffer>,temporary:GPUBuffer[]):GPUBuffer {
    this.ensure(device);
    const field=device.createBuffer({label:'curve-label-space',size:64*96*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    const offsets=device.createBuffer({label:'curve-label-placement',size:count*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
    const softened=device.createBuffer({label:'curve-label-soft-space',size:64*96*4,usage:GPUBufferUsage.STORAGE});
    const visibility=device.createBuffer({label:'curve-label-presence',size:presence.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(visibility,0,presence);
    temporary.push(field,offsets,softened,visibility);encoder.clearBuffer(field);
    const group=device.createBindGroup({layout:this.layout!,entries:[uniform,points,field,offsets,softened,visibility].map((buffer,binding)=>({binding,resource:{buffer}}))});
    if(avoidance>0){
      const scatter=encoder.beginComputePass({label:'curve-label-space'});scatter.setPipeline(this.occupy!);scatter.setBindGroup(0,group);
      scatter.dispatchWorkgroups(Math.ceil(pointCount/64));scatter.end();
      for(const pipeline of [this.softenX!,this.softenY!]){
        const blur=encoder.beginComputePass({label:'curve-label-soft-space'});blur.setPipeline(pipeline);blur.setBindGroup(0,group);
        blur.dispatchWorkgroups(96);blur.end();
      }
    }
    const solve=encoder.beginComputePass({label:'curve-label-placement'});solve.setPipeline(this.arrange!);solve.setBindGroup(0,group);
    solve.dispatchWorkgroups(Math.ceil(count/16));solve.end();return offsets;
  }
  private ensure(device:GPUDevice):void {
    if(this.device===device)return;this.device=device;
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
      {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},
      ...[2,3,4].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage' as const}})),
      {binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}]});
    const module=device.createShaderModule({label:'curve-label-avoidance',code:common+'\n'+shader});
    const pipeline=(entryPoint:string)=>device.createComputePipeline({layout:device.createPipelineLayout({bindGroupLayouts:[this.layout!]}),compute:{module,entryPoint}});
    this.occupy=pipeline('occupy');this.arrange=pipeline('arrange');this.softenX=pipeline('softenX');this.softenY=pipeline('softenY');
  }
  dispose():void{this.device=undefined;this.layout=undefined;this.occupy=undefined;this.arrange=undefined;this.softenX=undefined;this.softenY=undefined;}
}
