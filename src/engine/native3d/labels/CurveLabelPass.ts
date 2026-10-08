import {curveLabelLock,curveLabelLocks} from './curveLabelLock';
import {curveLabelEpisode,curveLabelOpeningRank} from './curveLabelSchedule';
import {curveLabelGlitchEvent} from './curveLabelGlitch';
import glitchShader from './curveLabelGlitch.wgsl?raw';
import {curveLabelDecoration} from './curveLabelDecoration';
import common from './curveLabelProjection.wgsl?raw';
import { CurveLabelTracking } from './CurveLabelTracking';
import { CurveLabelAvoidance } from './CurveLabelAvoidance';
import shader from './curveLabels.wgsl?raw';
import type { SceneCamera } from '../../scene/types';
import { worldMatrixScale, type PreparedStrandLayer } from '../passes/StrandPass';
import { curveLabelCameraFrame } from '../../scene/curveLabelCamera';
import { multiplyMat4 } from '../../scene/SceneTransformUtils';
import { CurveLabelAtlas } from './CurveLabelAtlas';
import { curveLabelAnchors, curveLabelGlyphs, LABEL_GLYPHS } from './curveLabelLayout';
import { Logger } from '../../../services/logger';
const log=Logger.create('CurveScanLabels');

/** Thin world-space annotations over final strand positions; no CPU geometry evaluation or GPU readback. */
export class CurveLabelPass {
  private device?:GPUDevice;
  private readonly tracking=new CurveLabelTracking();
  private readonly avoidance=new CurveLabelAvoidance();
  private atlas?:CurveLabelAtlas;
  private lines?:GPURenderPipeline;
  private text?:GPURenderPipeline;
  private blocks?:GPURenderPipeline;
  private lockIcon?:GPURenderPipeline;
  private layout?:GPUBindGroupLayout;
  private readonly warned=new Set<string>();
  render(device:GPUDevice,encoder:GPUCommandEncoder,color:GPUTextureView,depth:GPUTextureView,
    plans:PreparedStrandLayer[],camera:SceneCamera,time:number,temporary:GPUBuffer[]):void {
    const active=plans.filter(p=>(p.layer.strands.program.render?.labels?.opacity??0)>0&&p.layer.opacity>0);
    if(!active.length)return;
    this.ensure(device);
    const buffer=(data:Float32Array|Uint32Array,usage:GPUBufferUsageFlags)=>{
      const b=device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});
      device.queue.writeBuffer(b,0,data as Float32Array<ArrayBuffer>);temporary.push(b);return b;
    };
    for(const {layer,buffers} of active){
      const spec=layer.strands.program.render!.labels!,curves=buffers.curves;
      if(!curves?.starts.length){
        if(!this.warned.has(layer.layerId)){log.warn('Curve Scan Labels have no curve topology to attach to.',{layerId:layer.layerId});this.warned.add(layer.layerId);}continue;
      }
      const follow=camera.curveLabelCameras?.[spec.lag]??curveLabelCameraFrame(camera);
      if(spec.lag>0&&!camera.curveLabelCameras?.[spec.lag]&&!this.warned.has(layer.layerId)){
        log.warn('Curve Scan Labels camera history unavailable for this renderer; using the current pose.',{layerId:layer.layerId});this.warned.add(layer.layerId);
      }
      const distance=follow.orthographic?1:spec.depth;
      const halfWidth=distance/Math.max(1e-5,Math.abs(follow.projectionX)),halfHeight=distance/Math.max(1e-5,Math.abs(follow.projectionY));
      const pixelScale=camera.viewport.height/Math.max(1,camera.referenceSize?.height??camera.viewport.height);
      const data=new Float32Array(108);
      data.set(multiplyMat4(camera.projectionMatrix,camera.viewMatrix),0);data.set(layer.worldMatrix,16);
      data.set([...follow.right,halfWidth],32);data.set([...follow.up,halfHeight],36);
      data.set([...follow.forward,0],40);data.set([...follow.position,0],44);
      data.set([camera.viewport.width,camera.viewport.height,spec.ringWeight,spec.leaderWeight],48);
      const colorValue=parseInt(spec.color.slice(1),16);
      data.set([(colorValue>>16&255)/255,(colorValue>>8&255)/255,(colorValue&255)/255,spec.opacity*layer.opacity],52);
      data.set([spec.width,spec.height,spec.lineWidth*pixelScale,spec.ringSize*pixelScale],56);
      data.set([spec.offset,spec.spacing,spec.depth,spec.count],60);data.set([time,spec.cycle,spec.transition,spec.dutyCycle],64);data.set([spec.drift,spec.avoidance,spec.style==='mixed'?1:0,spec.sizeVariation],68);
      data.set([spec.retarget,spec.releaseProgress,spec.followShare,spec.depthSpread],72);
      data.set([spec.motionSpeed,spec.depthMotion,spec.detachedFocus,spec.fontVariation],76);
      const markerColor=parseInt(spec.markerColor.slice(1),16);
      data.set([(markerColor>>16&255)/255,(markerColor>>8&255)/255,(markerColor&255)/255,spec.trackingGlow],80);
      const glitch=curveLabelGlitchEvent(time);
      data.set([glitch.age,glitch.event,spec.glitchStrength,spec.rotationRange*Math.PI/180],84);
      const lock=curveLabelLock(spec,time),live=curveLabelCameraFrame(camera);
      const liveDistance=live.orthographic?1:spec.depth;
      data.set([...live.right,liveDistance/Math.max(1e-5,Math.abs(live.projectionX))],88);
      data.set([...live.up,liveDistance/Math.max(1e-5,Math.abs(live.projectionY))],92);
      const strandRender=layer.strands.program.render!;
      const markerLift=((strandRender.profile?.radius??0)+(strandRender.width??0))*worldMatrixScale(layer.worldMatrix);
      data.set([...live.forward,markerLift],96);data.set([...live.position,0],100);
      data.set(lock?[lock.card,lock.amount,lock.age,lock.corner]:[-1,0,0,0],104);
      const missingLocks=spec.lockCount-curveLabelLocks(spec).length;
      const lockWarning=`${layer.layerId}:locks:${spec.lockCount}:${spec.cycle}:${spec.dutyCycle}:${spec.lockDuration}`;
      if(missingLocks>0&&!this.warned.has(lockWarning)){
        log.warn('Curve Scan Labels: some camera locks need longer visible card lifetimes.',{layerId:layer.layerId,missingLocks});this.warned.add(lockWarning);
      }
      const uniform=buffer(data,GPUBufferUsage.UNIFORM);
      const offsets=this.avoidance.encode(device,encoder,uniform,buffers.positions,curves.positions.length/3,spec.count,spec.avoidance,temporary);
      const sourceAnchors=curveLabelAnchors(curves.starts,curves.counts,spec);
      const targetAnchors=curveLabelAnchors(curves.starts,curves.counts,spec,true),anchors=new Float32Array(spec.count*16);
      let maxCopies=0;
      for(let card=0;card<spec.count;card++){
        anchors.set(sourceAnchors.subarray(card*4,card*4+4),card*16);
        anchors.set(targetAnchors.subarray(card*4,card*4+4),card*16+4);
        const timing=curveLabelEpisode(spec,time,card);anchors[card*16+3]=timing.birth;anchors[card*16+7]=timing.visible;
        const decoration=curveLabelDecoration(spec,time,card);
        const openingMarker=timing.cycle===0&&curveLabelOpeningRank(spec,card)<(spec.openingMarkers??0);
        anchors.set([decoration.copies,decoration.fade,decoration.bold,openingMarker?1:0],card*16+12);maxCopies=Math.max(maxCopies,decoration.copies);
        const target=targetAnchors[card*4+3],reference=curves.starts.length-1;
        anchors.set([curves.starts[target],curves.counts[target],curves.starts[reference],curves.counts[reference]],card*16+8);
      }
      const indices=buffer(anchors,GPUBufferUsage.STORAGE);
      const rangeData=new Uint32Array(curves.starts.length*2);
      for(let strand=0;strand<curves.starts.length;strand++)rangeData.set([curves.starts[strand],curves.counts[strand]],strand*2);
      const ranges=buffer(rangeData,GPUBufferUsage.STORAGE);
      const tracked=this.tracking.encode(device,encoder,uniform,buffers.positions,indices,ranges,spec.count,temporary);
      const glyphs=buffer(curveLabelGlyphs(spec,time),GPUBufferUsage.STORAGE);
      const group=device.createBindGroup({layout:this.layout!,entries:[{binding:0,resource:{buffer:uniform}},
        {binding:1,resource:{buffer:buffers.positions}},{binding:2,resource:{buffer:indices}},{binding:3,resource:{buffer:glyphs}},
        {binding:4,resource:this.atlas!.texture.createView()},{binding:5,resource:this.atlas!.sampler},{binding:6,resource:{buffer:offsets}},{binding:7,resource:{buffer:tracked}}]});
      const pass=encoder.beginRenderPass({label:'curve-scan-labels',colorAttachments:[{view:color,loadOp:'load',storeOp:'store'}],
        depthStencilAttachment:{view:depth,depthLoadOp:'load',depthStoreOp:'store'}});
      pass.setBindGroup(0,group);pass.setPipeline(this.lines!);pass.draw(6,spec.count*(132+36*maxCopies));
      pass.setPipeline(this.text!);pass.draw(6,spec.count*LABEL_GLYPHS*(maxCopies+1));
      if(spec.glitchStrength>0&&glitch.age>=0&&glitch.age<=6){pass.setPipeline(this.blocks!);pass.draw(6,spec.count*6*(maxCopies+1));}
      if(lock&&lock.amount>0){pass.setPipeline(this.lockIcon!);pass.draw(6,20);}
      pass.end();
    }
  }
  private ensure(device:GPUDevice):void {
    if(this.device===device)return;
    this.dispose();this.device=device;this.atlas=new CurveLabelAtlas(device);
    this.layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
      ...[1,2,3].map(binding=>({binding,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage' as const}})),
      {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:5,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:6,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:7,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
    const module=device.createShaderModule({label:'curve-scan-labels',code:common+'\n'+shader+'\n'+glitchShader});
    const pipeline=(entryPoint:string)=>device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[this.layout!]}),
      vertex:{module,entryPoint},fragment:{module,entryPoint:'fragment',targets:[{format:'rgba16float',blend:{
        color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
      primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'}});
    this.lines=pipeline('lines');this.text=pipeline('text');this.blocks=pipeline('blocks');this.lockIcon=pipeline('lockIcon');
  }
  dispose():void{this.tracking.dispose();this.avoidance.dispose();this.atlas?.dispose();this.atlas=undefined;this.device=undefined;this.lines=undefined;this.text=undefined;this.blocks=undefined;this.lockIcon=undefined;this.layout=undefined;this.warned.clear();}
}
