import {probeExportOutputParity} from './exportOutputParityProbe';
import {probeCameraStacks} from './curveLabelStackProbe';
import {curveLabelIntroState} from '../../src/engine/native3d/labels/curveLabelIntro';
import {probeStrandIds} from './strandIdsGpuProbe';
import {curveLabelLocks} from '../../src/engine/native3d/labels/curveLabelLock';
import {curveLabelEpisode,curveLabelCues} from '../../src/engine/native3d/labels/curveLabelSchedule';
import glitchShader from '../../src/engine/native3d/labels/curveLabelGlitch.wgsl?raw';
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
let validationDevice:GPUDevice|undefined;
try{
 const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No GPU adapter');
 const device=await adapter.requestDevice();validationDevice=device;device.pushErrorScope('validation');
 result.exportOutputParity=await probeExportOutputParity(device);
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
 const draw=async(time=2,depthClearValue=1)=>{
  const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];
  const clear=encoder.beginRenderPass({colorAttachments:[{view:hdr.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue}});clear.end();
  labels.render(device,encoder,hdr.createView(),depth.createView(),[plan],camera,time,temporary);
  const read=device.createBuffer({size:width*height*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  encoder.copyTextureToBuffer({texture:hdr},{buffer:read,bytesPerRow:width*8},[width,height]);device.queue.submit([encoder.finish()]);labels.afterSubmit();await read.mapAsync(GPUMapMode.READ);
  const values=Array.from(new Uint16Array(read.getMappedRange()),half);read.unmap();read.destroy();temporary.forEach(b=>b.destroy());return values;
 };

 const initial={...spec};
 Object.assign(spec,{introSpread:5,lifetimeVariation:1,scheduleSeed:17,openingMarkers:0});
 const noOpeningRings=await draw(0);
 spec.openingMarkers=2;const beforeOpening=await draw(0),openingRings=await draw(.06),openingRepeat=await draw(.06);
 const openingAlpha=openingRings.reduce((sum,n,i)=>sum+(i%4===3?n:0),0);
 const hiddenAlpha=noOpeningRings.reduce((sum,n,i)=>sum+(i%4===3?n:0),0);
 let stray=0,amber=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=(y*width+x)*4;
   if(Math.hypot(x-width/2,y-height/2)>18)stray+=openingRings[i+3];
   if(openingRings[i]>openingRings[i+1]&&openingRings[i+1]>openingRings[i+2]&&openingRings[i+3]>.2)amber++;
 }
 if(hiddenAlpha!==0||beforeOpening.some(n=>n!==0)||openingAlpha<5||amber<5||openingRings.some((n,i)=>n!==openingRepeat[i]))
   throw new Error('Opening markers must remain hidden until their card intro, then show amber rings deterministically.');
 result.openingMarkers={openingAlpha,hiddenAlpha,stray,amber};
 const fullRing=await draw(.22);
 const perimeter=(pixels:number[])=>{let sum=0;for(let y=height/2-9;y<height/2+10;y++)for(let x=width/2-9;x<width/2+10;x++){
   const radius=Math.hypot(x+.5-width/2,y+.5-height/2);
   if(radius>=5&&radius<=7)sum+=pixels[(y*width+x)*4+3];
 }return sum;};
 const partialPerimeter=perimeter(openingRings),fullPerimeter=perimeter(fullRing);
 if(partialPerimeter<2||fullPerimeter<partialPerimeter*2)throw new Error('Rings must trace a fixed-radius circumference before completing the circle.');
 result.ringTrace={partialPerimeter,fullPerimeter};

 const centerDepth=(camera.projectionMatrix[10]*-8+camera.projectionMatrix[14])/8;
 const skinDepth=(camera.projectionMatrix[10]*-7.75+camera.projectionMatrix[14])/7.75;
 const buried=await draw(.06,(centerDepth+skinDepth)/2);
 plan.layer.strands.program.render!.profile={plies:3,fibers:7,radius:.3,plyTwist:5,fiberTwist:-11};
 const onSurface=await draw(.06,(centerDepth+skinDepth)/2);
 const hiddenBehindOther=await draw(.06,.9);
 delete plan.layer.strands.program.render!.profile;
 // Isolate amber ring coverage: the green leader already grows during this intro.
 const alphaSum=(v:number[])=>{let sum=0;for(let y=height/2-9;y<height/2+10;y++)for(let x=width/2-9;x<width/2+10;x++){const i=(y*width+x)*4; if(v[i]>v[i+1]&&v[i+1]>v[i+2])sum+=v[i+3];}return sum;};
 result.markerSurface={buried:alphaSum(buried),surface:alphaSum(onSurface),foreground:alphaSum(hiddenBehindOther)};
 if(alphaSum(buried)>.01||alphaSum(onSurface)<5||alphaSum(hiddenBehindOther)>.01)
   throw new Error('Tracking rings must clear their own yarn surface but remain occluded by foreground geometry.');

 Object.assign(spec,initial);

 const headlineOriginal={...spec};
 Object.assign(spec,{introSpread:5,lifetimeVariation:1,scheduleSeed:17,introTitles:'KUNST? > ART > कला | KANN WEG.'});
 const whiteCount=(pixels:number[])=>pixels.reduce((count,n,i)=>count+(i%4===0&&n>.65&&pixels[i+1]>.6&&pixels[i+2]>.4&&n>=pixels[i+1]&&pixels[i+1]>=pixels[i+2]?1:0),0);
 const headlineEarly=await draw(.6);
 const firstIntro=curveLabelEpisode(spec,0,0),hindiTime=firstIntro.birth+2.8;
 const hindi=await draw(hindiTime),hindiState=curveLabelIntroState(spec,hindiTime);
 const movingHeadline=await draw(2.1);spec.introTextMotion=0;spec.introTextDepth=0;const flatHeadline=await draw(2.1);
 const headlineDepthDifference=movingHeadline.reduce((count,n,i)=>count+(Math.abs(n-flatHeadline[i])>.1?1:0),0);
 const lateHeadlines=await draw(40);spec.introTitles='';const ordinaryLate=await draw(40);
 if(whiteCount(headlineEarly)<100||whiteCount(hindi)<50||hindiState[0].row!==23||headlineDepthDifference<100||lateHeadlines.some((n,i)=>n!==ordinaryLate[i]))
   throw new Error('Headlines must render cream shaped words, change language, move independently in depth and end after the first episode.');
 result.headlines={earlyWhite:whiteCount(headlineEarly),hindiWhite:whiteCount(hindi),hindiState,headlineDepthDifference};
 Object.assign(spec,headlineOriginal);
 const first=await draw();
 // Change only GPU positions; the CPU rest curve remains unchanged.
 packed[0]=.8;packed[12]=.8;device.queue.writeBuffer(positions,0,packed);
 const second=await draw(),repeated=await draw();
 const markerEnergy=(pixels:number[],cx:number)=>{let sum=0;for(let y=height/2-9;y<height/2+10;y++)for(let x=cx-9;x<cx+10;x++)sum+=pixels[(y*width+x)*4+3];return sum;};
 const shifted=Math.round(width/2+.8*camera.projectionMatrix[0]/8*width/2);
 // A projected obstacle must move a card toward clear space, reproducibly.
 const avoidance=new CurveLabelAvoidance();
 const uniform=device.createBuffer({size:144*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const obstacle=new Float32Array(12*81);
 for(let y=0;y<9;y++)for(let x=0;x<9;x++){
   const i=(y*9+x)*12;obstacle[i]=(-.70+(x-4)*.012)*8/camera.projectionMatrix[0];
   obstacle[i+1]=((y-4)*.009)*8/camera.projectionMatrix[5];obstacle[i+7]=1;
 }
 const cloud=device.createBuffer({size:obstacle.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(cloud,0,obstacle);
 const placement=async(strength:number,time:number,source=cloud,pointCount=81,cardCount=2)=>{
   const data=Float32Array.from({length:144},(_,i)=>i===136?-1:0);data.set(multiplyMat4(camera.projectionMatrix,camera.viewMatrix));data.set(identity,16);
   data.set([1,0,0,5/camera.projectionMatrix[0]],32);data.set([0,1,0,5/camera.projectionMatrix[5]],36);
   data.set([0,0,-1,0],40);data.set([0,0,8,0],44);data.set([.43,.13,1,6],56);
   data.set([.74,.48,5,cardCount],60);data.set([time,8,0,0],64);data.set([.65,strength,0,0],68);data[76]=1;device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];
   const offsets=avoidance.encode(device,encoder,uniform,source,pointCount,cardCount,strength,new Float32Array(cardCount).fill(1),temporary);
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
 const periodicSpec={...spec};Object.assign(spec,{lifetimeVariation:1,scheduleSeed:17,introSpread:0});
 const episode=curveLabelEpisode(spec,20,0),visibleTime=episode.birth+spec.transition+.1;
 const randomVisible=await draw(visibleTime),randomHidden=await draw(episode.birth+episode.visible+.01);
 if(energy(randomVisible)<=0||energy(randomHidden)!==0)throw new Error('GPU reveal disagrees with randomized CPU episode');
 result.randomSchedule={episode,visible:energy(randomVisible),hidden:energy(randomHidden),cues:curveLabelCues({...spec,count:12,height:.11,introSpread:5,holdStart:22,holdEnd:27,holdCount:2},0,59)};
 Object.assign(spec,periodicSpec);

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
   const data=Float32Array.from({length:144},(_,i)=>i===136?-1:0);data.set([1,0,0,1],32);data.set([0,1,0,1],36);data.set([0,0,-1,0],40);data.set([0,0,8,0],44);
   data.set([.43,.11,1,6],56);data.set([.74,.3,5,6],60);data[64]=time;data[75]=.26;data[76]=1;data[77]=.3;device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(depthPipeline);
   pass.setBindGroup(0,device.createBindGroup({layout:depthPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:poseBuffer}}]}));pass.dispatchWorkgroups(6);pass.end();
   const read=device.createBuffer({size:96,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyBufferToBuffer(poseBuffer,0,read,0,96);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=[...new Float32Array(read.getMappedRange())].filter((_,i)=>i%4===2);read.unmap();read.destroy();return values;
 };
 const depthBefore=await probeDepth(5),depthAfter=await probeDepth(15);
 if(Math.max(...depthBefore)-Math.min(...depthBefore)<1||Math.abs(depthBefore[0]-depthAfter[0])<2)throw new Error('Cards do not spread and travel through depth');
 result.depthTravel={before:depthBefore,after:depthAfter};poseBuffer.destroy();
 const rotationModule=device.createShaderModule({code:projectionShader+`
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> angles:array<vec4f>;
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){angles[id.x]=vec4f(cardRotation(id.x),1);}`});
 const rotationPipeline=device.createComputePipeline({layout:'auto',compute:{module:rotationModule,entryPoint:'probe'}});
 const angles=device.createBuffer({size:12*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const probeRotation=async(time:number)=>{
  const data=Float32Array.from({length:144},(_,i)=>i===136?-1:0);data[64]=time;data[68]=.65;data[76]=.35;data[87]=Math.PI/4;device.queue.writeBuffer(uniform,0,data);
  const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(rotationPipeline);
  pass.setBindGroup(0,device.createBindGroup({layout:rotationPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:angles}}]}));pass.dispatchWorkgroups(12);pass.end();
  const read=device.createBuffer({size:192,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});encoder.copyBufferToBuffer(angles,0,read,0,192);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
  const values=[...new Float32Array(read.getMappedRange())].filter((_,i)=>i%4<2);read.unmap();read.destroy();return values;
 };
 const rotationFirst=await probeRotation(2),rotationNext=await probeRotation(2+1/60),rotationLater=await probeRotation(30);
 const rotationStep=Math.max(...rotationFirst.map((v,i)=>Math.abs(v-rotationNext[i])));
 if([...rotationFirst,...rotationLater].some(v=>Math.abs(v)>Math.PI/4+1e-6)||rotationStep>.01||Math.max(...rotationFirst)-Math.min(...rotationFirst)<.4)throw new Error('Window rotations are not bounded, varied and smooth');
 if(Math.max(...rotationFirst.map((v,i)=>Math.abs(v-rotationLater[i])))<.3)throw new Error('Window rotation is static');
 const aligned=Array(12).fill(0);let smoothestStep=rotationStep;
 for(let time=0;time<=59;time+=.5){
   const a=await probeRotation(time),b=await probeRotation(time+1/60);
   for(let card=0;card<12;card++)if(Math.hypot(a[card*2],a[card*2+1])<1e-6)aligned[card]++;
   smoothestStep=Math.max(smoothestStep,...a.map((v,i)=>Math.abs(v-b[i])));
   if(a.some(v=>Math.abs(v)>Math.PI/4+1e-6))throw new Error('Window excursion exceeded 45 degrees');
 }
 result.windowRotation={first:rotationFirst,later:rotationLater,maxFrameStep:smoothestStep,alignedSamples:aligned};
 if(aligned.some(n=>n<5)||smoothestStep>.0045)throw new Error('Window rotations do not settle parallel or jump between excursions');
 angles.destroy();
 const lockModule=device.createShaderModule({code:projectionShader+`
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> positions:array<vec4f>;
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){
 let q=array<vec2f,3>(vec2f(0),vec2f(.5,0),vec2f(0,.5));
 let point=projectedCardPoint(0u,q[id.x],vec2f(.2,-.2));
 let clip=p.vp*vec4f(point,1);positions[id.x]=vec4f(clip.xyz/clip.w,1);
}`});
 const lockPipeline=device.createComputePipeline({layout:'auto',compute:{module:lockModule,entryPoint:'probe'}});
 const lockOut=device.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const probeLock=async(yaw:number,amount:number)=>{
  const right=[Math.cos(yaw),0,-Math.sin(yaw)],forward=[-Math.sin(yaw),0,-Math.cos(yaw)],eye=[3,2,10];
  const view=Float32Array.of(right[0],0,-forward[0],0,0,1,0,0,right[2],0,-forward[2],0,
    -(right[0]*eye[0]+right[2]*eye[2]),-eye[1],forward[0]*eye[0]+forward[2]*eye[2],1);
  const d=Float32Array.from({length:144},(_,i)=>i===136?-1:0);d.set(multiplyMat4(camera.projectionMatrix,view));
  d.set([1,0,0,5/camera.projectionMatrix[0]],32);d.set([0,1,0,5/camera.projectionMatrix[5]],36);
  d.set([0,0,-1,0],40);d.set([0,0,8,0],44);d.set([.43,.11,1,6],56);d.set([.74,.3,5,12],60);
  d[64]=20;d[68]=.65;d[75]=.3;d[76]=.35;d[77]=.3;d[87]=Math.PI/4;
  d.set([...right,5/camera.projectionMatrix[0]],88);d.set([0,1,0,5/camera.projectionMatrix[5]],92);
  d.set([...forward,0],96);d.set([...eye,0],100);d.set([0,amount,1,1],104);device.queue.writeBuffer(uniform,0,d);
  const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(lockPipeline);
  p.setBindGroup(0,device.createBindGroup({layout:lockPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:lockOut}}]}));p.dispatchWorkgroups(3);p.end();
  const r=device.createBuffer({size:48,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});e.copyBufferToBuffer(lockOut,0,r,0,48);device.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);
  const values=[...new Float32Array(r.getMappedRange())];r.unmap();r.destroy();return values;
 };
 const lockedA=await probeLock(0,1),lockedB=await probeLock(.8,1),unlocked=await probeLock(.8,0);
 if(lockedA.some((v,i)=>Math.abs(v-lockedB[i])>1e-5)||Math.abs(lockedB[0]-.705)>1e-5||Math.abs(lockedB[1]-.865)>1e-5)throw new Error('Camera lock drifts from its screen corner');
 if(Math.abs(lockedB[5]-lockedB[1])>1e-5||Math.abs(lockedB[8]-lockedB[0])>1e-5||Math.abs(lockedB[2]-lockedB[6])>1e-5)throw new Error('Locked card not parallel to live camera');
 if(Math.hypot(unlocked[0]-lockedB[0],unlocked[1]-lockedB[1])<.1)throw new Error('Unlocked card did not return to floating pose');
 result.cameraLock={lockedA,lockedB,unlocked};lockOut.destroy();
 const metricModule=device.createShaderModule({code:projectionShader+`
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read_write> dimensions:array<vec4f>;
@compute @workgroup_size(1) fn probe(@builtin(global_invocation_id) id:vec3u){
 let q=cardMetrics(id.x);dimensions[id.x]=vec4f(q.x*p.right.w,q.y*p.up.w,0,0);}`});
 const metricPipeline=device.createComputePipeline({layout:'auto',compute:{module:metricModule,entryPoint:'probe'}});
 const dims=device.createBuffer({size:64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const metricData=Float32Array.from({length:144},(_,i)=>i===136?-1:0);metricData[35]=2;metricData[39]=5;metricData.set([.43,.11,1,6],56);metricData[70]=1;metricData[71]=.85;device.queue.writeBuffer(uniform,0,metricData);
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
   const data=Float32Array.from({length:144},(_,i)=>i===136?-1:0);data[63]=1;data[72]=blend;data[74]=1;data[78]=1;device.queue.writeBuffer(uniform,0,data);
   const encoder=device.createCommandEncoder(),temporary:GPUBuffer[]=[];const output=tracker.encode(device,encoder,uniform,trackingPoints,selections,topology,1,temporary);
   const read=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(output,0,read,0,16);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const values=[...new Float32Array(read.getMappedRange())];read.unmap();read.destroy();temporary.forEach(b=>b.destroy());return values;
 };
 const approaching=await track(.5),acquired=await track(1);
 if(approaching[3]!==0||acquired[0]<2.5||acquired[3]<.99)throw new Error(`Detached target/color gate failed: ${approaching}, ${acquired}`);
 const snapshot=await tracker.capture(device,trackingPoints,{positions:new Float32Array(24),starts:Uint32Array.of(0,4),counts:Uint32Array.of(4,4)},
   {...spec,count:1,firstStrand:0,start:0,step:0,holdAnchors:'',anchorOverrides:'',holdCount:0,stackCount:0,retarget:1,releaseProgress:0,followShare:1,detachedFocus:1},0);
 if(snapshot.tracked.some((v,i)=>Math.abs(v-acquired[i])>1e-6))throw new Error('Diagnostic acquisition disagrees with the rendered GPU tracker');
 const finalSnapshot=await tracker.capture(device,trackingPoints,{positions:new Float32Array(24),starts:Uint32Array.of(0,4),counts:Uint32Array.of(4,4)},
   {...spec,count:2,firstStrand:0,start:.5,step:0,holdAnchors:'',anchorOverrides:'',holdCount:0,stackCount:0,retarget:1,releaseProgress:1,followShare:1,detachedFocus:1},0);
 if(finalSnapshot.tracked[7]!==1)throw new Error('Fully released last curve was compared against itself');
 result.detachedTracking={approaching,acquired,snapshot:[...snapshot.tracked],finalReadiness:finalSnapshot.tracked[7]};tracker.dispose();trackingPoints.destroy();selections.destroy();topology.destroy();


 // Test the actual shader envelope at screen-space corners and at the center.
 const waveModule=device.createShaderModule({code:projectionShader+'\n'+glitchShader+`
 @group(0) @binding(0) var<uniform> p:Params;
 @group(0) @binding(1) var<storage,read> offsets:array<vec4f>;
 @group(0) @binding(2) var<storage,read_write> result:array<vec4f>;
 @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
   let points=array<vec2f,3>(vec2f(1,1),vec2f(0),vec2f(-1,-1));
   let arrival=glitchArrival(points[id.x]);let recovery=glitchRecovery(id.x);
   result[id.x]=vec4f(arrival,recovery,glitchEnvelope(.25,arrival,recovery),glitchEnvelope(6.01,arrival,recovery));
 }`});
 const wavePipeline=device.createComputePipeline({layout:'auto',compute:{module:waveModule,entryPoint:'main'}});
 const waveOutput=device.createBuffer({size:48,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const waveRead=device.createBuffer({size:48,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const waveEncoder=device.createCommandEncoder(),wavePass=waveEncoder.beginComputePass();
 // Unused bindings disappear from the automatic layout.
 wavePass.setPipeline(wavePipeline);wavePass.setBindGroup(0,device.createBindGroup({layout:wavePipeline.getBindGroupLayout(0),entries:[
   {binding:0,resource:{buffer:uniform}},{binding:2,resource:{buffer:waveOutput}}]}));wavePass.dispatchWorkgroups(3);wavePass.end();
 waveEncoder.copyBufferToBuffer(waveOutput,0,waveRead,0,48);device.queue.submit([waveEncoder.finish()]);await waveRead.mapAsync(GPUMapMode.READ);
 const waveSamples=Array.from(new Float32Array(waveRead.getMappedRange()));waveRead.unmap();waveRead.destroy();waveOutput.destroy();
 if(waveSamples[0]!==0||waveSamples[4]!==1.5||waveSamples[8]!==3||waveSamples[2]<=0||waveSamples[6]!==0||waveSamples[10]!==0)
   throw new Error('Glitch front did not travel top-right to bottom-left in three seconds');
 const recoveries=[waveSamples[1],waveSamples[5],waveSamples[9]];
 if(recoveries.some(t=>t<1||t>2)||new Set(recoveries).size!==3||[waveSamples[3],waveSamples[7],waveSamples[11]].some(v=>v!==0))
   throw new Error('Glitch recovery is not independently bounded to one–two seconds');
 spec.glitchStrength=1;const disrupted=await draw(13.8),disruptedAgain=await draw(13.8);
 spec.glitchStrength=0;const clean=await draw(13.8);
 const changed=clean.filter((v,i)=>Math.abs(v-disrupted[i])>.01).length;
 if(changed<100||disrupted.some((v,i)=>v!==disruptedAgain[i]))throw new Error(`Missing or nondeterministic window glitch: ${changed}`);
 // Leader curves now morph near the ring; verify their fixed attachments separately below.
 spec.glitchStrength=1;const recovered=await draw(18.1);spec.glitchStrength=0;const cleanAfter=await draw(18.1);
 if(recovered.some((v,i)=>v!==cleanAfter[i]))throw new Error('Glitch did not fully recover');
 const glowingPixels=disrupted.filter((v,i)=>i%4!==3&&v>1.05).length;
 if(glowingPixels<20)throw new Error(`Window glitch lacks emissive accents: ${glowingPixels}`);
 result.windowGlitch={changed,recoveries,waveSamples,glowingPixels,deterministic:true,recovered:true};
 const shapeModule=device.createShaderModule({code:projectionShader+'\n'+glitchShader+`
 @group(0) @binding(0) var<uniform> p:Params;
 @group(0) @binding(1) var<storage,read> offsets:array<vec4f>;
 @group(0) @binding(2) var<storage,read_write> result:array<vec4f>;
 @compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
   let i=id.x;let q=vec2f(.42,.31);let a=vec3f(0,0,0);let b=vec3f(2,1,0);
   if(i==0u){result[i]=vec4f(glitchGeometry(q,0.,13.),glitchGeometry(q,1.,13.));}
   else if(i<=9u){result[i]=vec4f(glitchLeaderPoint(0u,a,b,f32(i-1u)/8.),1);}
   else {result[i]=vec4f(windowGlyphScale(0u,f32(i-10u)),0,0,0);}
 }`});
 const shapePipeline=device.createComputePipeline({layout:'auto',compute:{module:shapeModule,entryPoint:'main'}});
 const shapeData=Float32Array.from({length:144},(_,i)=>i===136?-1:0);shapeData.set(multiplyMat4(camera.projectionMatrix,camera.viewMatrix));
 shapeData.set([1,0,0,1],32);shapeData.set([0,1,0,1],36);shapeData.set([0,0,-1,0],40);shapeData.set([0,0,8,0],44);
 shapeData.set([.43,.13,1,6],56);shapeData.set([0,.3,5,1],60);shapeData[64]=13.8;shapeData[76]=1;shapeData.set([1.8,0,1,0],84);device.queue.writeBuffer(uniform,0,shapeData);
 const zeroOffset=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE});
 const shapeOut=device.createBuffer({size:14*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const shapeRead=device.createBuffer({size:14*16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const shapeEncoder=device.createCommandEncoder(),shapePass=shapeEncoder.beginComputePass();shapePass.setPipeline(shapePipeline);
 shapePass.setBindGroup(0,device.createBindGroup({layout:shapePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:zeroOffset}},{binding:2,resource:{buffer:shapeOut}}]}));shapePass.dispatchWorkgroups(14);shapePass.end();
 shapeEncoder.copyBufferToBuffer(shapeOut,0,shapeRead,0,14*16);device.queue.submit([shapeEncoder.finish()]);await shapeRead.mapAsync(GPUMapMode.READ);
 const shapeValues=[...new Float32Array(shapeRead.getMappedRange())];shapeRead.unmap();shapeRead.destroy();shapeOut.destroy();zeroOffset.destroy();
 if(Math.hypot(shapeValues[0]-.42,shapeValues[1]-.31)>1e-6||Math.hypot(shapeValues[2]-.42,shapeValues[3]-.31)<.05)throw new Error('Window geometry does not distort or fails to recover');
 if(shapeValues.slice(4,7).some(v=>v!==0)||shapeValues[36]!==2||shapeValues[37]!==1||shapeValues[38]!==0)throw new Error('Glitch leader detached from endpoint');
 const curveDeviation=Math.max(...Array.from({length:7},(_,i)=>Math.hypot(shapeValues[(i+2)*4]-(i+1)/4,shapeValues[(i+2)*4+1]-(i+1)/8,shapeValues[(i+2)*4+2])));
 const fontScales=Array.from({length:4},(_,i)=>shapeValues[(i+10)*4]);
 if(curveDeviation<.05||Math.max(...fontScales)-Math.min(...fontScales)<.2)throw new Error('Missing curved leaders or independent font size glitches');
 result.glitchGeometry={curveDeviation,fontScales,fixedEndpoints:true};
 const lockSpec={...spec,lockCount:3,introSpread:5,lifetimeVariation:1,scheduleSeed:17};
 Object.assign(spec,lockSpec);const events=curveLabelLocks(spec);
 if(events.length!==3)throw new Error('Expected three visible camera lock events');
 const lockFrame=await draw(events[0].start+1);
 const lockPixels=lockFrame.filter((v,i)=>i%4<3&&v>.05).length;
 if(lockPixels<200)throw new Error('Camera lock not rendered');
 result.cameraStacks=await probeCameraStacks(device,camera);
 result.strandMaterialIds=await probeStrandIds(device,camera,identity);
 const validation=await device.popErrorScope();validationDevice=undefined;if(validation)throw new Error(validation.message);
 result.cameraLockEvents=events;
 const a=markerEnergy(first,width/2),b=markerEnergy(second,width/2),c=markerEnergy(second,shifted);
 if(!(a>b+12&&c>20))throw new Error(`Marker did not follow GPU positions: ${a}, ${b}, ${c}`);
 if(second.some((v,i)=>v!==repeated[i]))throw new Error('Repeated frame changed');
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;document.body.append(canvas);
 const ctx=canvas.getContext('2d')!,image=ctx.createImageData(width,height);second.forEach((v,i)=>image.data[i]=Math.round(Math.max(0,Math.min(1,v))*255));ctx.putImageData(image,0,0);
 Object.assign(result,{success:true,markerBefore:a,oldPositionAfter:b,newPositionAfter:c,deterministic:true,image:canvas.toDataURL()});
 uniform.destroy();labels.dispose();hdr.destroy();depth.destroy();positions.destroy();device.destroy();
}catch(error){Object.assign(result,{success:false,error:String(error)});
 if(validationDevice){const validation=await validationDevice.popErrorScope();if(validation)result.validationError=validation.message;}
}
document.querySelector('#result')!.textContent=JSON.stringify({...result,image:undefined},null,2);
document.title=result.success?'PASS · Curve Scan Labels':'FAIL · Curve Scan Labels';
const report=new URLSearchParams(location.search).get('report');
if(report&&/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(report))await fetch(report,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
