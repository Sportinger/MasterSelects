import {CurveLabelAvoidance} from '../../src/engine/native3d/labels/CurveLabelAvoidance';
import {multiplyMat4} from '../../src/engine/scene/SceneTransformUtils';
import {CurveLabelPass} from '../../src/engine/native3d/labels/CurveLabelPass';
import {CURVE_LABEL_OPERATOR,readCurveLabels} from '../../src/services/operators/geometry/curveLabels';
import {curveLabelCameraFrame} from '../../src/engine/scene/curveLabelCamera';
import {packStrandPoints} from '../../src/engine/native3d/passes/strandFrames';
import {perspective} from '../../src/engine/scene/cameraUtils/projectionMatrices';
import type {SceneCamera} from '../../src/engine/scene/types';
import type {PreparedStrandLayer} from '../../src/engine/native3d/passes/StrandPass';
const result:Record<string,unknown>={};
try{
 const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No GPU adapter');
 const device=await adapter.requestDevice();device.pushErrorScope('validation');
 const width=512,height=768;
 const hdr=device.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 const depth=device.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
 const identity=Float32Array.of(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1);
 const view=identity.slice();view[14]=-8;
 const camera={viewMatrix:view,projectionMatrix:perspective(Math.PI/5,width/height,.1,100),cameraPosition:{x:0,y:0,z:8},
   cameraTarget:{x:0,y:0,z:0},cameraUp:{x:0,y:1,z:0},fov:36,near:.1,far:100,viewport:{width,height},referenceSize:{width,height},projection:'perspective'} as SceneCamera;
 const defaults=Object.fromEntries(CURVE_LABEL_OPERATOR.parameters.map(p=>[p.id,p.default]));
 const spec=readCurveLabels(id=>({...defaults,count:12,height:.11,opacity:1,start:.5,step:0,lag:0,lineWidth:2,style:'mixed',sizeVariation:.6})[id]);
 camera.curveLabelCameras={'0':curveLabelCameraFrame(camera)};
 const curves={positions:Float32Array.of(0,-.2,0,0,.2,0),starts:Uint32Array.of(0),counts:Uint32Array.of(2)};
 const packed=packStrandPoints(curves);
 const positions=device.createBuffer({size:packed.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(positions,0,packed);
 const plan={layer:{layerId:'fixture',opacity:1,worldMatrix:identity,strands:{program:{render:{labels:spec}}}},buffers:{positions,curves}} as PreparedStrandLayer;
 const labels=new CurveLabelPass();
 const half=(bits:number)=>{const e=(bits>>10)&31,m=bits&1023;return(bits>>15?-1:1)*(e===0?m*2**-24:(1+m/1024)*2**(e-15));};
 const draw=async()=>{
  const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];
  const clear=encoder.beginRenderPass({colorAttachments:[{view:hdr.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});clear.end();
  labels.render(device,encoder,hdr.createView(),depth.createView(),[plan],camera,2,temporary);
  const read=device.createBuffer({size:width*height*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  encoder.copyTextureToBuffer({texture:hdr},{buffer:read,bytesPerRow:width*8},[width,height]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=Array.from(new Uint16Array(read.getMappedRange()),half);read.unmap();read.destroy();temporary.forEach(b=>b.destroy());return values;
 };
 const first=await draw();
 // Change only GPU positions; the CPU rest curve remains unchanged.
 packed[0]=.8;packed[12]=.8;device.queue.writeBuffer(positions,0,packed);
 const second=await draw(),repeated=await draw();
 const markerEnergy=(pixels:number[],cx:number)=>{let sum=0;for(let y=height/2-9;y<height/2+10;y++)for(let x=cx-9;x<cx+10;x++)sum+=pixels[(y*width+x)*4+3];return sum;};
 const shifted=Math.round(width/2+.8*camera.projectionMatrix[0]/8*width/2);
 // A projected obstacle must move a card toward clear space, reproducibly.
 const avoidance=new CurveLabelAvoidance();
 const uniform=device.createBuffer({size:72*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const obstacle=new Float32Array(12*81);
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
   const i=(y*9+x)*12;obstacle[i]=(-.70+(x-4)*.012)*8/camera.projectionMatrix[0];
   obstacle[i+1]=((y-4)*.009)*8/camera.projectionMatrix[5];obstacle[i+7]=1;
 }
 const cloud=device.createBuffer({size:obstacle.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cloud,0,obstacle);
 const placement=async(strength:number,time:number,source=cloud,pointCount=81)=>{
   const data=new Float32Array(72);data.set(multiplyMat4(camera.projectionMatrix,camera.viewMatrix));data.set(identity,16);
   data.set([1,0,0,5/camera.projectionMatrix[0]],32);data.set([0,1,0,5/camera.projectionMatrix[5]],36);
   data.set([0,0,-1,0],40);data.set([0,0,8,0],44);data.set([.43,.13,1,6],56);
   data.set([.74,.48,5,2],60);data.set([time,8,0,0],64);data.set([.65,strength,0,0],68);device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];
   const offsets=avoidance.encode(device,encoder,uniform,source,pointCount,2,strength,temporary);
   const read=device.createBuffer({size:32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   encoder.copyBufferToBuffer(offsets,0,read,0,32);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=[...new Float32Array(read.getMappedRange())];read.unmap();read.destroy();temporary.forEach(b=>b.destroy());return values;
 };
 const neutral=await placement(0,2),avoided=await placement(1,2),same=await placement(1,2),later=await placement(0,6);
 if(!avoided.every(Number.isFinite)||Math.hypot(avoided[0]-neutral[0],avoided[1]-neutral[1])<.015)throw new Error('Card did not leave projected obstacle');
 if(avoided.some((v,i)=>v!==same[i]))throw new Error('Avoidance changed on repeated frame');
 if(Math.hypot(later[0]-neutral[0],later[1]-neutral[1])<.005)throw new Error('Card floating motion is static');
 const halfCloud=new Float32Array(32*64*12);
 for(let y=0;y<64;y++)for(let x=0;x<32;x++){
   const i=(y*32+x)*12;halfCloud[i]=(-.94+x*.86/31)*8/camera.projectionMatrix[0];
   halfCloud[i+1]=(-.94+y*1.88/63)*8/camera.projectionMatrix[5];halfCloud[i+7]=1;
 }
 const crowded=device.createBuffer({size:halfCloud.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(crowded,0,halfCloud);
 const migrated=await placement(1,2,crowded,32*64);
 if(migrated[0]-.74<.3)throw new Error(`Card remained trapped on crowded left side: ${migrated[0]}`);
 result.sideMigration=migrated[0]-.74;crowded.destroy();
 Object.assign(result,{avoidance:{neutral,avoided,deterministic:true},floating:true});
 avoidance.dispose();uniform.destroy();cloud.destroy();
 const error=await device.popErrorScope();if(error)throw new Error(error.message);
 const a=markerEnergy(first,width/2),b=markerEnergy(second,width/2),c=markerEnergy(second,shifted);
 if(!(a>b+12&&c>20))throw new Error(`Marker did not follow GPU positions: ${a}, ${b}, ${c}`);
 if(second.some((v,i)=>v!==repeated[i]))throw new Error('Repeated frame changed');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;document.body.append(canvas);
 const ctx=canvas.getContext('2d')!,image=ctx.createImageData(width,height);second.forEach((v,i)=>image.data[i]=Math.round(Math.max(0,Math.min(1,v))*255));ctx.putImageData(image,0,0);
 Object.assign(result,{success:true,markerBefore:a,oldPositionAfter:b,newPositionAfter:c,deterministic:true,image:canvas.toDataURL()});
 labels.dispose();hdr.destroy();depth.destroy();positions.destroy();device.destroy();
}catch(error){Object.assign(result,{success:false,error:String(error)});}
document.querySelector('#result')!.textContent=JSON.stringify({...result,image:undefined},null,2);
document.title=result.success?'PASS · Curve Scan Labels':'FAIL · Curve Scan Labels';
const report=new URLSearchParams(location.search).get('report');
if(report&&/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(report))await fetch(report,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
