import {curveLabelDecoration} from '../../src/engine/native3d/labels/curveLabelDecoration';
import projectionShader from '../../src/engine/native3d/labels/curveLabelProjection.wgsl?raw';
import {CurveLabelTracking} from '../../src/engine/native3d/labels/CurveLabelTracking';
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
 const draw=async(time=2)=>{
  const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];
  const clear=encoder.beginRenderPass({colorAttachments:[{view:hdr.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});clear.end();
  labels.render(device,encoder,hdr.createView(),depth.createView(),[plan],camera,time,temporary);
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
 const uniform=device.createBuffer({size:84*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const obstacle=new Float32Array(12*81);
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
   const i=(y*9+x)*12;obstacle[i]=(-.70+(x-4)*.012)*8/camera.projectionMatrix[0];
   obstacle[i+1]=((y-4)*.009)*8/camera.projectionMatrix[5];obstacle[i+7]=1;
 }
 const cloud=device.createBuffer({size:obstacle.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cloud,0,obstacle);
 const placement=async(strength:number,time:number,source=cloud,pointCount=81,cardCount=2)=>{
   const data=new Float32Array(84);data.set(multiplyMat4(camera.projectionMatrix,camera.viewMatrix));data.set(identity,16);
   data.set([1,0,0,5/camera.projectionMatrix[0]],32);data.set([0,1,0,5/camera.projectionMatrix[5]],36);
   data.set([0,0,-1,0],40);data.set([0,0,8,0],44);data.set([.43,.13,1,6],56);
   data.set([.74,.48,5,cardCount],60);data.set([time,8,0,0],64);data.set([.65,strength,0,0],68);data[76]=1;device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];
   const offsets=avoidance.encode(device,encoder,uniform,source,pointCount,cardCount,strength,temporary);
   const read=device.createBuffer({size:cardCount*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
   encoder.copyBufferToBuffer(offsets,0,read,0,cardCount*16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=[...new Float32Array(read.getMappedRange())];read.unmap();read.destroy();temporary.forEach(b=>b.destroy());return values;
 };
 const neutral=await placement(0,2),avoided=await placement(1,2),same=await placement(1,2),later=await placement(0,6);
 if(!avoided.every(Number.isFinite)||Math.hypot(avoided[0]-neutral[0],avoided[1]-neutral[1])<.015)throw new Error('Card did not leave projected obstacle');
 if(avoided.some((v,i)=>v!==same[i]))throw new Error('Avoidance changed on repeated frame');
 if(Math.hypot(later[0]-neutral[0],later[1]-neutral[1])<.005)throw new Error('Card floating motion is static');
 const perturbed=obstacle.slice();for(let i=0;i<81;i++)perturbed[i*12]+=.006;
 device.queue.writeBuffer(cloud,0,perturbed);const nearby=await placement(1,2);device.queue.writeBuffer(cloud,0,obstacle);
 const placementChange=Math.hypot(nearby[0]-avoided[0],nearby[1]-avoided[1]);
 if(placementChange>.012)throw new Error(`Small curve movement makes cards jump: ${placementChange}`);
 result.placementStability=placementChange;
 const halfCloud=new Float32Array(32*64*12);
 for(let y=0;y<64;y++)for(let x=0;x<32;x++){
   const i=(y*32+x)*12;halfCloud[i]=(-.94+x*.86/31)*8/camera.projectionMatrix[0];
   halfCloud[i+1]=(-.94+y*1.88/63)*8/camera.projectionMatrix[5];halfCloud[i+7]=1;
 }
 const crowded=device.createBuffer({size:halfCloud.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(crowded,0,halfCloud);
 const migrated=await placement(1,2,crowded,32*64);
 if(migrated[0]-.74<.3)throw new Error(`Card remained trapped on crowded left side: ${migrated[0]}`);
 result.sideMigration=migrated[0]-.74;
 const lowerCloud=halfCloud.slice();for(let i=0;i<32*64;i++)lowerCloud[i*12+1]=(-.94+Math.floor(i/32)*.88/63)*8/camera.projectionMatrix[5];
 device.queue.writeBuffer(crowded,0,lowerCloud);const localSpace=await placement(1,2,crowded,32*64,6);
 if(localSpace[0]>.35||localSpace[16]<.7)throw new Error(`Free upper-left space was ignored: ${localSpace[0]}, ${localSpace[16]}`);
 result.localFreeSpace={upperShift:localSpace[0],lowerShift:localSpace[16]};crowded.destroy();
 Object.assign(result,{avoidance:{neutral,avoided,deterministic:true},floating:true});
 avoidance.dispose();cloud.destroy();
 const savedSpec={...spec};Object.assign(spec,{count:1,style:'uniform',drift:0,avoidance:0});
 const hidden=await draw(spec.cycle*spec.dutyCycle+.1),intro=await draw(.12),shown=await draw(.5),outro=await draw(spec.cycle*spec.dutyCycle-.12);
 const energy=(pixels:number[])=>pixels.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);
 const energies={hidden:energy(hidden),intro:energy(intro),shown:energy(shown),outro:energy(outro)};
 if(energies.hidden!==0||energies.intro<=0||energies.shown<=energies.intro*1.5||energies.outro>=energies.shown*.8)throw new Error(`Invalid card lifecycle: ${JSON.stringify(energies)}`);
 result.lifecycle=energies;
 const thinMarker=await draw(2);spec.ringWeight=2.5;const thickMarker=await draw(2);
 const thinEnergy=markerEnergy(thinMarker,shifted),thickEnergy=markerEnergy(thickMarker,shifted);
 if(thickEnergy<thinEnergy*1.5)throw new Error(`Marker weight did not increase: ${thinEnergy}, ${thickEnergy}`);
 result.markerWeight={thin:thinEnergy,thick:thickEnergy};spec.ringWeight=1;
 spec.markerColor='#ffdc39';const yellowRing=await draw(2);
 let yellowRed=0,yellowGreen=0,yellowBlue=0;
 for(let y=height/2-9;y<height/2+10;y++)for(let x=shifted-9;x<shifted+10;x++){
   const i=(y*width+x)*4;yellowRed+=yellowRing[i];yellowGreen+=yellowRing[i+1];yellowBlue+=yellowRing[i+2];
 }
 if(yellowRed<yellowBlue*2||yellowGreen<yellowBlue*2)throw new Error('Tracking ring did not use its independent yellow color');
 result.markerColor={red:yellowRed,green:yellowGreen,blue:yellowBlue};
 spec.trackingGlow=1;const glowing=await draw(2);spec.trackingGlow=0;const plain=await draw(2);
 const haloPixels=glowing.filter((v,i)=>i%4===3&&plain[i]<.001&&v>.005).length;
 if(haloPixels<20)throw new Error(`Tracking halo is missing: ${haloPixels}`);
 const disabledAgain=await draw(2);
 if(plain.some((v,i)=>v!==disabledAgain[i]))throw new Error('Disabling tracking glow did not restore the original raster');
 spec.leaderWeight=3;const thickLeaders=await draw(2);spec.leaderWeight=1;
 if(energy(thickLeaders)<=energy(plain))throw new Error('Leader thickness did not increase');
 result.trackingGlow={haloPixels,plain:energy(plain),glow:energy(glowing),thickLeaders:energy(thickLeaders)};
 spec.echoStrength=1;
 const echoTime=Array.from({length:800},(_,i)=>i/100).find(t=>curveLabelDecoration(spec,t,0).fade>.9)!;
 const echo=await draw(echoTime),echoRepeat=await draw(echoTime);spec.echoStrength=0;const withoutEcho=await draw(echoTime);
 if(energy(echo)<=energy(withoutEcho)*1.1||echo.some((v,i)=>v!==echoRepeat[i]))throw new Error('Window echoes are missing or nondeterministic');
 result.echoes={time:echoTime,copies:curveLabelDecoration({...spec,echoStrength:1},echoTime,0).copies,with:energy(echo),without:energy(withoutEcho)};

 Object.assign(spec,{retarget:1,releaseProgress:.2,followShare:1});
 const alert=await draw(2),alertAgain=await draw(2);
 const red=alert.reduce((sum,v,i)=>sum+(i%4===0?v:0),0),green=alert.reduce((sum,v,i)=>sum+(i%4===1?v:0),0);
 if(red<green*2||alert.some((v,i)=>v!==alertAgain[i]))throw new Error('Alert color is missing or not repeatable');
 result.alert={red,green,deterministic:true};Object.assign(spec,savedSpec);
 const depthModule=device.createShaderModule({code:projectionShader+`
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> poses:array<vec4f>;
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){poses[id.x]=vec4f(projectedCardPoint(id.x,vec2f(0),vec2f(0)),1);}`});
 const depthPipeline=device.createComputePipeline({layout:'auto',compute:{module:depthModule,entryPoint:'probe'}});
 const poseBuffer=device.createBuffer({size:6*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const probeDepth=async(time:number)=>{
   const data=new Float32Array(84);data.set([1,0,0,1],32);data.set([0,1,0,1],36);data.set([0,0,-1,0],40);data.set([0,0,8,0],44);
   data.set([.43,.11,1,6],56);data.set([.74,.3,5,6],60);data[64]=time;data[75]=.26;data[76]=1;data[77]=.3;device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(depthPipeline);
   pass.setBindGroup(0,device.createBindGroup({layout:depthPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:poseBuffer}}]}));pass.dispatchWorkgroups(6);pass.end();
   const read=device.createBuffer({size:96,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyBufferToBuffer(poseBuffer,0,read,0,96);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=[...new Float32Array(read.getMappedRange())].filter((_,i)=>i%4===2);read.unmap();read.destroy();return values;
 };
 const depthBefore=await probeDepth(5),depthAfter=await probeDepth(15);
 if(Math.max(...depthBefore)-Math.min(...depthBefore)<1||Math.abs(depthBefore[0]-depthAfter[0])<2)throw new Error('Cards do not spread and travel through depth');
 result.depthTravel={before:depthBefore,after:depthAfter};poseBuffer.destroy();
 const metricModule=device.createShaderModule({code:projectionShader+`
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> dimensions:array<vec4f>;
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){
 let q=cardMetrics(id.x);dimensions[id.x]=vec4f(q.x*p.right.w,q.y*p.up.w,0,0);}`});
 const metricPipeline=device.createComputePipeline({layout:'auto',compute:{module:metricModule,entryPoint:'probe'}});
 const dims=device.createBuffer({size:64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const metricData=new Float32Array(84);metricData[35]=2;metricData[39]=5;metricData.set([.43,.11,1,6],56);metricData[70]=1;metricData[71]=.85;device.queue.writeBuffer(uniform,0,metricData);
 const metricEncoder=device.createCommandEncoder(),metricPass=metricEncoder.beginComputePass();metricPass.setPipeline(metricPipeline);
 metricPass.setBindGroup(0,device.createBindGroup({layout:metricPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:dims}}]}));metricPass.dispatchWorkgroups(4);metricPass.end();
 const metricRead=device.createBuffer({size:64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});metricEncoder.copyBufferToBuffer(dims,0,metricRead,0,64);device.queue.submit([metricEncoder.finish()]);await metricRead.mapAsync(GPUMapMode.READ);
 const dimensions=[...new Float32Array(metricRead.getMappedRange())];
 if(Math.abs(dimensions[8]-dimensions[9])>.0001||Math.abs(dimensions[12]-dimensions[13])>.0001)throw new Error('Circle or square has unequal physical dimensions');
 result.equalSides={circle:dimensions.slice(8,10),square:dimensions.slice(12,14)};metricRead.unmap();metricRead.destroy();dims.destroy();
 const tracker=new CurveLabelTracking();
 const source=packStrandPoints({positions:Float32Array.of(0,0,0,1,0,0,3,0,0,0,0,0,0,.1,0,.1,.1,0,.2,.1,0,0,.1,0),starts:Uint32Array.of(0,4),counts:Uint32Array.of(4,4)});
 const trackingPoints=device.createBuffer({size:source.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(trackingPoints,0,source);
 const selections=device.createBuffer({size:64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(selections,0,Float32Array.of(0,1,0,0,0,1,0,8,0,4,4,4,0,0,0,0));
 const topology=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(topology,0,Uint32Array.of(0,4,4,4));
 const track=async(blend:number)=>{
   const data=new Float32Array(84);data[63]=1;data[72]=blend;data[74]=1;data[78]=1;device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];const output=tracker.encode(device,encoder,uniform,trackingPoints,selections,topology,1,temporary);
   const read=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(output,0,read,0,16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=[...new Float32Array(read.getMappedRange())];read.unmap();read.destroy();temporary.forEach(b=>b.destroy());return values;
 };
 const approaching=await track(.5),acquired=await track(1);
 if(approaching[3]!==0||acquired[0]<2.5||acquired[3]<.99)throw new Error(`Detached target/color gate failed: ${approaching}, ${acquired}`);
 result.detachedTracking={approaching,acquired};tracker.dispose();trackingPoints.destroy();selections.destroy();topology.destroy();uniform.destroy();

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
