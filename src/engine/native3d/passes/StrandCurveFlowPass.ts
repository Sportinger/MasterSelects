import shader from '../shaders/StrandCurveFlow.wgsl?raw';
import type {GeometryStage} from '../../../services/operators/geometry/geometryProgram';
export type StrandCurveFlow = Extract<GeometryStage,{kind:'curve-flow'}>;

/** Resample on GPU, retaining the existing packed-point and metric contracts. */
export class StrandCurveFlowPass {
  private device?:GPUDevice;
  private layout?:GPUBindGroupLayout;
  private flow?:GPUComputePipeline;
  private validate?:GPUComputePipeline;
  private initialize(device:GPUDevice):void {
    if(this.device===device)return;
    const module=device.createShaderModule({label:'strand-curve-flow',code:shader});
    this.layout=device.createBindGroupLayout({entries:Array.from({length:6},(_,binding)=>({binding,
      visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===0?'uniform':binding<4?'read-only-storage':'storage'}}))});
    const layout=device.createPipelineLayout({bindGroupLayouts:[this.layout]});
    this.flow=device.createComputePipeline({label:'strand-curve-flow',layout,compute:{module,entryPoint:'flow'}});
    this.validate=device.createComputePipeline({label:'strand-curve-flow-validation',layout,compute:{module,entryPoint:'validate'}});
    this.device=device;
  }
  /** Return a validation dispatch to run after the caller has measured the final geometry. */
  encode(device:GPUDevice,encoder:GPUCommandEncoder,packed:GPUBuffer,scratch:GPUBuffer,ranges:GPUBuffer,
    contexts:GPUBuffer,metrics:GPUBuffer,points:number,strands:number,spec:StrandCurveFlow,temporary:GPUBuffer[]):(pass:GPUComputePassEncoder)=>void {
    const phase=spec.distance?spec.phase:((spec.phase%1)+1)%1;
    if(!Number.isFinite(Math.fround(phase)))throw new Error('Closed Curve Flow travel exceeds finite GPU precision.');
    this.initialize(device);
    const groups=Math.ceil(points/256),width=Math.min(groups,device.limits.maxComputeWorkgroupsPerDimension);
    const stats=Math.ceil(strands/64),statsWidth=Math.min(stats,device.limits.maxComputeWorkgroupsPerDimension);
    const values=new ArrayBuffer(32);new Uint32Array(values).set([points,strands,width,statsWidth,0,spec.distance?1:0]);
    new Float32Array(values)[4]=phase;
    const uniform=device.createBuffer({label:'strand-flow-params',size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    temporary.push(uniform);device.queue.writeBuffer(uniform,0,values);
    encoder.copyBufferToBuffer(packed,0,scratch,0,points*48);
    const group=device.createBindGroup({layout:this.layout!,entries:[uniform,scratch,ranges,contexts,packed,metrics]
      .map((buffer,binding)=>({binding,resource:{buffer}}))});
    const pass=encoder.beginComputePass({label:'strand-curve-flow'});
    pass.setPipeline(this.flow!);pass.setBindGroup(0,group);pass.dispatchWorkgroups(width,Math.ceil(groups/width));pass.end();
    return pass=>{
      pass.setPipeline(this.validate!);pass.setBindGroup(0,group);pass.dispatchWorkgroups(statsWidth,Math.ceil(stats/statsWidth));
    };
  }
  dispose():void {this.device=undefined;this.layout=undefined;this.flow=undefined;this.validate=undefined;}
}
