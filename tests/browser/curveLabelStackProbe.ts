import common from '../../src/engine/native3d/labels/curveLabelProjection.wgsl?raw';
import {multiplyMat4} from '../../src/engine/scene/SceneTransformUtils';
import type {SceneCamera} from '../../src/engine/scene/types';
/** Project real shader card corners, independently of glyph pixels or a particular font. */
export async function probeCameraStacks(device:GPUDevice,camera:SceneCamera):Promise<Record<string,unknown>> {
 const module=device.createShaderModule({code:common+`
 @group(0) @binding(0) var<uniform> p:Params;
 @group(0) @binding(1) var<storage,read_write> results:array<vec4f>;
 @compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){
  let card=id.x/4u;let corner=id.x%4u;
  let q=vec2f(select(-.5,.5,corner%2u==1u),select(-.5,.5,corner>=2u));
  let clip=p.vp*vec4f(placedCardPoint(card,q,vec2f(.3,-.2),p.animation.z),1);
  results[id.x]=vec4f(clip.xyz/clip.w,cameraLockAmount(card));
 }`});
 const pipeline=device.createComputePipeline({layout:'auto',compute:{module,entryPoint:'probe'}});
 const uniform=device.createBuffer({size:136*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const output=device.createBuffer({size:48*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:output}}]});
 const probe=async(pan:number,time:number,height:number,depthYield=0)=>{
  const d=new Float32Array(136),view=camera.viewMatrix.slice();view[12]=-pan;
  d.set(multiplyMat4(camera.projectionMatrix,view));d.set([1,0,0,5/camera.projectionMatrix[0]],32);
  d.set([0,1,0,5/camera.projectionMatrix[5]],36);d.set([0,0,-1,0],40);d.set([0,0,8,0],44);
  d.set([.43,height,1,6],56);d.set([.74,.48,5,12],60);d.set([time,8,.45,.72],64);
  d.set([.65,1,1,.85],68);d[76]=.35;d[78]=depthYield;d[87]=Math.PI/4;
  d.set([1,0,0,5/camera.projectionMatrix[0]],88);d.set([0,1,0,5/camera.projectionMatrix[5]],92);
  d.set([0,0,-1,0],96);d.set([pan,0,8,0],100);d[104]=-1;d.set([-1,-1,0,1],108);
  d.set([3,13,21,0],120);device.queue.writeBuffer(uniform,0,d);
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(48);pass.end();
  const read=device.createBuffer({size:48*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyBufferToBuffer(output,0,read,0,48*16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=[...new Float32Array(read.getMappedRange())];read.unmap();read.destroy();return values;
 };
 const first=await probe(0,16,.11),moved=await probe(3,16,.11),released=await probe(3,22,.11),large=await probe(0,16,.5);
 const bounds=(values:number[])=>Array.from({length:12},(_,card)=>{
  const points=Array.from({length:4},(_,corner)=>values.slice((card*4+corner)*4,(card*4+corner)*4+4));
  return {x0:Math.min(...points.map(p=>p[0])),x1:Math.max(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),y1:Math.max(...points.map(p=>p[1]))};
 });
 for(const values of [first,large]){
  const all=bounds(values),boxes=all.slice(0,6);
  // Free cards are arranged against visible stack footprints by the avoidance pass,
  // not collapsed onto a hard horizontal ceiling by this projection function.
  if(values.some(v=>!Number.isFinite(v))||boxes.some(b=>b.x0<-.95||b.x1>.95||b.y0<-.95||b.y1>.3))throw new Error('Stack escaped the lower side regions');
  for(let side=0;side<2;side++)for(let row=1;row<3;row++)
   if(boxes[row*2+side].y0-boxes[(row-1)*2+side].y1<.03)throw new Error('Stacked cards overlap');
 }
 if(first.some((v,i)=>i<24*4&&i%4<2&&Math.abs(v-moved[i])>1e-5))throw new Error('Stack did not remain pinned while camera moved');
 if(released.filter((_,i)=>i%4===3).some(v=>v!==0))throw new Error('Stack stayed locked after its interval');
 const delta=Math.max(...first.map((v,i)=>i%4<2?Math.abs(v-released[i]):0));
 if(delta<.1)throw new Error('Released cards did not return to floating placement');
 const retreat=await probe(0,16,.11,.5);
 const baseBounds=bounds(first),retreatBounds=bounds(retreat);
 for(let card=0;card<12;card++){
  const a=baseBounds[card],b=retreatBounds[card];
  if(card<6){
   if(Math.abs(a.x0-b.x0)+Math.abs(a.x1-b.x1)>1e-5)throw new Error('Crowding moved a locked card');
  }else{
   if(b.x1-b.x0>=a.x1-a.x0)throw new Error('Depth yield did not reduce a floating card footprint');
  }
 }
 uniform.destroy();output.destroy();return {bounds:bounds(first),largeBounds:bounds(large),cameraPinned:true,releasedDelta:delta};
}
