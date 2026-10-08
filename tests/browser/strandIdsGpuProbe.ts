import {StrandPass,type PreparedStrandLayer} from '../../src/engine/native3d/passes/StrandPass';
import {StrandIdCapture} from '../../src/engine/native3d/passes/StrandIdCapture';
import {strandPixelHit} from '../../src/engine/native3d/passes/strandIdMap';
import {packStrandPoints} from '../../src/engine/native3d/passes/strandFrames';
import {strandSegmentStarts} from '../../src/engine/native3d/passes/strandBuffers';
import type {SceneCamera} from '../../src/engine/scene/types';

export async function probeStrandIds(device:GPUDevice,camera:SceneCamera,world:Float32Array){
 const curves={positions:Float32Array.of(-1,0,1,1,0,1,-1,0,0,1,0,0),starts:Uint32Array.of(0,2),counts:Uint32Array.of(2,2)};
 const packed=packStrandPoints(curves),indices=strandSegmentStarts(curves.starts,curves.counts);
 const positions=device.createBuffer({size:packed.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(positions,0,packed);
 const segments=device.createBuffer({size:indices.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(segments,0,indices);
 const plan={layer:{clipId:'fixture',layerId:'fixture-strands',opacity:1,worldMatrix:world,
   strands:{program:{render:{nodeId:'render',width:.03,color:'#ffffff'},stages:[]}}},
   buffers:{positions,segments,segmentCount:2,segmentLength:2,extent:2,curves}} as unknown as PreparedStrandLayer;
 const pass=new StrandPass(),capture=new StrandIdCapture();
 const depth=device.createTexture({size:[camera.viewport.width,camera.viewport.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const setDepth=(value:number)=>{const encoder=device.createCommandEncoder();const p=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:depth.createView(),depthClearValue:value,depthLoadOp:'clear',depthStoreOp:'store'}});p.end();device.queue.submit([encoder.finish()]);};
 capture.remember('fixture',{device,plans:[plan],camera,depth:depth.createView(),time:0});setDepth(1);
 try{
  const first=await capture.capture(pass,'fixture',0),center=[camera.viewport.width/2,camera.viewport.height/2];
  const a=strandPixelHit(first,center[0],center[1]);
  if(!a||a.strand!==0||Math.abs(a.u-.5)>.02)throw new Error('ID pass did not pick the front fiber/material coordinate');
  // Change GPU geometry only, leaving CPU rest topology in place.
  packed[2]=-1;packed[14]=-1;device.queue.writeBuffer(positions,0,packed);
  const next=await capture.capture(pass,'fixture',0),b=strandPixelHit(next,center[0],center[1]);
  if(!b||b.strand!==1||Math.abs(b.u-.5)>.02)throw new Error('ID pass ignored final GPU geometry or occlusion');
  const repeat=await capture.capture(pass,'fixture',0);
  if(next.pixels.some((v,i)=>v!==repeat.pixels[i]))throw new Error('ID pass is not repeatable');
  setDepth(.1);const occluded=await capture.capture(pass,'fixture',0);
  if(occluded.pixels.some(v=>v!==0))throw new Error('ID pass ignored scene occlusion');
  let staleRejected=false;try{await capture.capture(pass,'fixture',1);}catch{staleRejected=true;}
  if(!staleRejected)throw new Error('ID capture accepted a stale frame');
  return {front:a,moved:b,sceneOcclusion:true,deterministic:true,staleRejected};
 }finally{capture.clear();pass.dispose();positions.destroy();segments.destroy();depth.destroy();}
}
