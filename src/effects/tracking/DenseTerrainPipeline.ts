import { Logger } from '../../services/logger';
import { footstepCandidates, placeAnalysisCard, endingCandidateShift } from './footstepCandidates';
import shader from './denseTerrain.wgsl?raw';
import projectionShader from './terrainContentProjection.wgsl?raw';
import decisionShader from './footstepDecision.wgsl?raw';
import searchShader from './terrainSearchHud.wgsl?raw';
import { upcomingDecisions, type FootstepDecision } from './footstepDecisions';
import type { Effect } from '../../types/effects';
import type { DenseTerrainMesh } from '../../types/terrainTracking';
import type { TerrainProjectionDescriptor } from '../../types/terrainAttachment';
import { defaultTerrainPlacement } from '../../services/planarTracking/terrainPlacement';
import { terrainCameraPoint, terrainProject } from '../../services/planarTracking/terrainGeometry';
import { sampleOcclusion } from '../../services/planarTracking/surfaceGeometry';

type TerrainRender = NonNullable<Effect['terrainRender']> & { decision?: FootstepDecision };

interface Geometry {buffer:GPUBuffer;count:number;bounds:number[];heights:number[];shadow:GPUTexture}

/** Rasterized mesh/depth passes: work scales with geometry, not triangles × video pixels. */
export class DenseTerrainPipeline {
  private meshes=new Map<DenseTerrainMesh,Geometry>();
  private layout:GPUBindGroupLayout;
  private shadowLayout:GPUBindGroupLayout;
  private meshPipeline:GPURenderPipeline;
  private shadowPipeline:GPURenderPipeline;
  private copyPipeline:GPURenderPipeline;
  private hudPipeline:GPURenderPipeline;
  private projectionLayout:GPUBindGroupLayout;
  private projectionCopyPipeline:GPURenderPipeline;
  private projectionMeshPipeline:GPURenderPipeline;
  private projectionShadowPipeline:GPURenderPipeline;
  private projectionUniforms=new Map<string,GPUBuffer>();
  private depths=new Map<string,GPUTexture>();
  private pathTargets=new Map<string,GPUTexture>();
  private copyShadow?:GPUTexture;
  private device:GPUDevice;
  constructor(device:GPUDevice){
    this.device=device;
    const module=device.createShaderModule({label:'Dense terrain projection',code:shader+decisionShader+searchShader});
    const projectionModule=device.createShaderModule({label:'Terrain content projection',code:projectionShader});
    void module.getCompilationInfo().then(info=>{
      for(const message of info.messages)if(message.type==='error')Logger.create('DenseTerrain').error(`Shader line ${message.lineNum}: ${message.message}`);
    });
    void projectionModule.getCompilationInfo().then(info=>{
      for(const message of info.messages)if(message.type==='error')Logger.create('DenseTerrain').error(`Projection shader line ${message.lineNum}: ${message.message}`);
    });
    this.layout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},
      {binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}},
    ]});
    this.shadowLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'uniform'}}]});
    this.projectionLayout=device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},
      {binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{}},
      {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'depth'}},
    ]});
    const buffers:GPUVertexBufferLayout[]=[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}];
    const layout=device.createPipelineLayout({bindGroupLayouts:[this.layout]});
    this.copyPipeline=device.createRenderPipeline({layout,vertex:{module,entryPoint:'copyVertex'},fragment:{module,entryPoint:'copyFragment',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    this.hudPipeline=device.createRenderPipeline({layout,vertex:{module,entryPoint:'copyVertex'},fragment:{module,entryPoint:'hudFragment',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    this.meshPipeline=device.createRenderPipeline({layout,vertex:{module,entryPoint:'meshVertex',buffers},fragment:{module,entryPoint:'meshFragment',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    this.shadowPipeline=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[this.shadowLayout]}),vertex:{module,entryPoint:'shadowVertex',buffers},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    const projectionPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[this.projectionLayout]});
    const projectionShadowLayout=device.createPipelineLayout({bindGroupLayouts:[this.shadowLayout]});
    this.projectionCopyPipeline=device.createRenderPipeline({layout:projectionPipelineLayout,vertex:{module:projectionModule,entryPoint:'terrainProjectionCopyVertex'},fragment:{module:projectionModule,entryPoint:'terrainProjectionCopyFragment',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    this.projectionMeshPipeline=device.createRenderPipeline({layout:projectionPipelineLayout,vertex:{module:projectionModule,entryPoint:'terrainProjectionVertex',buffers},fragment:{module:projectionModule,entryPoint:'terrainProjectionFragment',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
    this.projectionShadowPipeline=device.createRenderPipeline({layout:projectionShadowLayout,vertex:{module:projectionModule,entryPoint:'terrainProjectionShadowVertex',buffers},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
  }
  private geometry(mesh:DenseTerrainMesh):Geometry{
    const existing=this.meshes.get(mesh);if(existing)return existing;
    const data=new Float32Array(mesh.indices.length*3);
    mesh.indices.forEach((index,i)=>{for(let j=0;j<3;j++)data[i*3+j]=mesh.positions[index*3+j];});
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<mesh.positions.length;i+=3){
      const delta=[mesh.positions[i]-mesh.origin[0],mesh.positions[i+1]-mesh.origin[1],mesh.positions[i+2]-mesh.origin[2]];
      [mesh.axisX,mesh.axisY,mesh.normal].forEach((axis,j)=>{const v=axis.reduce((s,a,k)=>s+a*delta[k],0);low[j]=Math.min(low[j],v);high[j]=Math.max(high[j],v);});
    }
    const buffer=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:true});new Float32Array(buffer.getMappedRange()).set(data);buffer.unmap();
    const shadowSize=mesh.indices.length<100000?512:2048;
    const shadow=this.device.createTexture({size:[shadowSize,shadowSize],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
    const result={buffer,count:mesh.indices.length,bounds:[low[0],low[1],Math.max(1e-6,high[0]-low[0]),Math.max(1e-6,high[1]-low[1])],heights:[low[2]-.001,high[2]+.001,high[2]-low[2]+.002,0],shadow};
    this.meshes.set(mesh,result);
    return result;
  }
  encode(encoder:GPUCommandEncoder,render:TerrainRender,sampler:GPUSampler,input:GPUTextureView,output:GPUTextureView,width:number,height:number){
    // A path shares cameras and only draws the contacts currently in the future.
    // Local patches avoid rasterizing the entire trail for every footprint.
    if(render.track.terrain?.footsteps?.length){
      const {track,camera}=render,terrain=track.terrain!;
      const decisions=track.footstepPresentation==='decision'
        ?upcomingDecisions(terrain.footsteps!,camera.time,terrain.cameras[0].time,.7):undefined;
      const entries:TerrainRender[]=decisions
        ?decisions.map(decision=>({camera,decision,track:{...track,terrain:{...terrain,footsteps:undefined,denseMesh:decision.step.mesh??terrain.denseMesh},placement:decision.step.placement,visibleFrom:decision.start,visibleTo:decision.step.placement.contactTime!,fade:0}}))
        :terrain.footsteps!.filter(step=>{const time=step.placement.contactTime!;return camera.time>=time-(track.footstepLookAhead??3)&&camera.time<=time;}).map(step=>({camera,track:{...track,terrain:{...terrain,footsteps:undefined,denseMesh:step.mesh??terrain.denseMesh},placement:step.placement,visibleFrom:step.placement.contactTime!-(track.footstepLookAhead??3),visibleTo:step.placement.contactTime!}}));
      const interlude=track.footstepInterlude;
      const scenic=interlude&&camera.time>=interlude.start&&camera.time<interlude.end;
      if(decisions&&scenic)entries.length=0;
      if(entries.length){
        const firstTarget=decisions?this.pathTarget(width,height,0):output;
        this.encode(encoder,entries[0],sampler,input,firstTarget,width,height);
        let previous=firstTarget;
        for(let i=1;i<entries.length;i++){
          const target=this.pathTarget(width,height,i%2);
          this.encode(encoder,entries[i],sampler,previous,target,width,height);
          previous=target;
        }
        if(previous!==output)this.copyColor(encoder,sampler,previous,output,width,height,decisions?render:undefined);
      }else this.copyColor(encoder,sampler,input,output,width,height,decisions?render:undefined);
      return;
    }
    const {track,camera}=render,terrain=track.terrain!,mesh=terrain.denseMesh!;
    const geometry=this.geometry(mesh),placement=track.placement??defaultTerrainPlacement(mesh),k=terrain.intrinsics;
    const r=camera.rotation,t=camera.translation;
    const fade=track.fade>0?Math.max(0,Math.min(1,(camera.time-track.visibleFrom)/track.fade,(track.visibleTo-camera.time)/track.fade)):1;
    const hex=/^#[0-9a-f]{6}$/i.test(track.color)?track.color:'#ff3535',color=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const contour=placement.contour??[],occ=sampleOcclusion(track,camera.time);
    const data=new Float32Array((17+32+8+2+48)*4);
    data.set([...r.slice(0,3),t[0],...r.slice(3,6),t[1],...r.slice(6,9),t[2],
      k.fx/k.width,k.fy/k.height,k.cx/k.width,k.cy/k.height,k.k1??0,width,height,Math.min(4,camera.occluders?.length??0),
      ...mesh.origin,0,...mesh.axisX,0,...mesh.axisY,0,...mesh.normal,0,
      placement.x,placement.y,Math.max(1e-6,placement.width),Math.max(1e-6,placement.height),
      placement.rotation*Math.PI/180,track.opacity*fade,track.fill,track.lineWidth,...color,placement.profile==='hiking'?1:0,
      track.shape==='ellipse'?1:track.shape==='cross'?2:0,track.showMesh?1:0,Math.min(32,contour.length),track.inset,
      ...(occ?occ.flatMap(p=>[p.x,p.y]):Array(8).fill(-2)),...geometry.bounds,...geometry.heights]);
    data[23]=placement.labelX??.5;data[27]=placement.labelY??.415;
    contour.slice(0,32).forEach((p,i)=>data.set(p,68+i*4));
    camera.occluders?.slice(0,4).forEach((quad,i)=>data.set(quad.flat(),196+i*8));
    if(render.decision){const d=render.decision;data.set([1,d.age,d.scanDuration,placement.side==='left'?1:placement.side==='right'?2:0,d.confidence,d.seed,d.locked?1:0,d.searchOnly?-1-(d.endingAge??0):d.isNext?1:0],228);}
    const uniform=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});new Float32Array(uniform.getMappedRange()).set(data);uniform.unmap();
    const shadowView=geometry.shadow.createView();
    const shadowGroup=this.device.createBindGroup({layout:this.shadowLayout,entries:[{binding:0,resource:{buffer:uniform}}]});
    const shadowPass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:shadowView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    shadowPass.setPipeline(this.shadowPipeline);shadowPass.setBindGroup(0,shadowGroup);shadowPass.setVertexBuffer(0,geometry.buffer);shadowPass.draw(geometry.count);shadowPass.end();
    const group=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:sampler},{binding:2,resource:input},{binding:3,resource:shadowView}]});
    const copy=encoder.beginRenderPass({colorAttachments:[{view:output,loadOp:'clear',storeOp:'store'}]});copy.setPipeline(this.copyPipeline);copy.setBindGroup(0,group);copy.draw(3);copy.end();
    const key=`${width}:${height}`;
    let depth=this.depths.get(key);
    if(!depth){depth=this.device.createTexture({size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});this.depths.set(key,depth);}
    const pass=encoder.beginRenderPass({colorAttachments:[{view:output,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
    pass.setPipeline(this.meshPipeline);pass.setBindGroup(0,group);pass.setVertexBuffer(0,geometry.buffer);pass.draw(geometry.count);pass.end();
  }
  /** Projects an already-rendered layer texture through the solved terrain mesh. */
  encodeContentProjection(encoder:GPUCommandEncoder,projection:TerrainProjectionDescriptor,sampler:GPUSampler,content:GPUTextureView,background:GPUTextureView,output:GPUTextureView,width:number,height:number,opacity=1,uniformKey=projection.attachment.targetVideoClipId):boolean{
    const mesh=projection.attachment.footstepId
      ?projection.terrain.footsteps?.find(step=>step.id===projection.attachment.footstepId)?.mesh??projection.terrain.denseMesh
      :projection.terrain.denseMesh;
    if(!projection.attachment.visible||!mesh||!projection.camera||!Number.isFinite(opacity)||opacity<=0)return false;
    const geometry=this.geometry(mesh),camera=projection.camera,k=projection.terrain.intrinsics,r=camera.rotation,t=camera.translation,placement=projection.attachment.placement;
    const data=new Float32Array(100);
    data.set([...r.slice(0,3),t[0],...r.slice(3,6),t[1],...r.slice(6,9),t[2],
      k.fx/k.width,k.fy/k.height,k.cx/k.width,k.cy/k.height,
      width,height,k.k1??0,0,
      ...mesh.origin,0,...mesh.axisX,0,...mesh.axisY,0,...mesh.normal,0,
      placement.x,placement.y,Math.max(1e-6,placement.width),Math.max(1e-6,placement.height),
      placement.rotation*Math.PI/180,Math.min(1,opacity),Math.min(4,camera.occluders?.length??0),projection.contentBounds?1:0,
      ...geometry.bounds,...geometry.heights]);
    const sourceTransform=projection.sourceTransform??[1,0,0,0,1,0,0,0,1];
    data.set(sourceTransform.slice(0,3),84);
    data.set(sourceTransform.slice(3,6),88);
    data.set(sourceTransform.slice(6,9),92);
    const contentBounds=projection.contentBounds??{x:0,y:0,width:1,height:1};
    data.set([contentBounds.x,contentBounds.y,contentBounds.width,contentBounds.height],96);
    camera.occluders?.slice(0,4).forEach((quad,index)=>{if(quad.length===4)data.set(quad.flat(),52+index*8);});
    let uniform=this.projectionUniforms.get(uniformKey);
    if(!uniform){uniform=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.projectionUniforms.set(uniformKey,uniform);}
    this.device.queue.writeBuffer(uniform,0,data);
    const shadowView=geometry.shadow.createView();
    const shadowGroup=this.device.createBindGroup({layout:this.shadowLayout,entries:[{binding:0,resource:{buffer:uniform}}]});
    const shadowPass=encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:shadowView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
    shadowPass.setPipeline(this.projectionShadowPipeline);shadowPass.setBindGroup(0,shadowGroup);shadowPass.setVertexBuffer(0,geometry.buffer);shadowPass.draw(geometry.count);shadowPass.end();
    const group=this.device.createBindGroup({layout:this.projectionLayout,entries:[
      {binding:0,resource:{buffer:uniform}},{binding:1,resource:sampler},{binding:2,resource:background},{binding:3,resource:content},{binding:4,resource:shadowView},
    ]});
    const copyPass=encoder.beginRenderPass({colorAttachments:[{view:output,loadOp:'clear',storeOp:'store'}]});
    copyPass.setPipeline(this.projectionCopyPipeline);copyPass.setBindGroup(0,group);copyPass.draw(3);copyPass.end();
    const depthKey=`${width}:${height}`;
    let cameraDepth=this.depths.get(depthKey);
    if(!cameraDepth){cameraDepth=this.device.createTexture({size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});this.depths.set(depthKey,cameraDepth);}
    const projectionPass=encoder.beginRenderPass({colorAttachments:[{view:output,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:cameraDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
    projectionPass.setPipeline(this.projectionMeshPipeline);projectionPass.setBindGroup(0,group);projectionPass.setVertexBuffer(0,geometry.buffer);projectionPass.draw(geometry.count);projectionPass.end();
    return true;
  }
  private pathTarget(width:number,height:number,index:number):GPUTextureView{
    const key=`${width}:${height}:${index}`;let texture=this.pathTargets.get(key);
    if(!texture){texture=this.device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.pathTargets.set(key,texture);}
    return texture.createView();
  }
  private copyColor(encoder:GPUCommandEncoder,sampler:GPUSampler,input:GPUTextureView,output:GPUTextureView,width:number,height:number,hud?:TerrainRender){
    const data=new Float32Array((17+32+8+2+48)*4);data.set([0,width,height,0],16);
    if(hud){const beat=hud.track.footstepInterlude;data.set([2,hud.camera.time,beat?.start??-100,beat?.end??-100,beat?.dropMeters??0,beat?.dropGreaterThan?1:0,0,0],228);}
    if(hud?.track.terrain){
      const terrain=hud.track.terrain;
      data[235]=terrain.cameras[0].time;
      const decisions=upcomingDecisions(terrain.footsteps??[],hud.camera.time,terrain.cameras[0].time,.7);
      let count=0;
      const cardOrigins:number[][]=[];
      const cards:number[][]=[];
      let groundTop=1;
      for(const d of decisions){
        const mesh=d.step.mesh??terrain.denseMesh;if(!mesh)continue;
        const placement=d.step.placement;
        for(const candidate of footstepCandidates(d)){
        if(cards.length>=16)break;
        const angle=placement.rotation*Math.PI/180;
        const shift=d.searchOnly?endingCandidateShift(candidate.spatialSeed,candidate.index-1,placement,this.geometry(mesh).bounds):candidate.shift;
        const dx=shift[0]*placement.width,dy=shift[1]*placement.height;
        const x=placement.x+Math.cos(angle)*dx-Math.sin(angle)*dy;
        const y=placement.y+Math.sin(angle)*dx+Math.cos(angle)*dy;
        const world=mesh.origin.map((v,i)=>v+mesh.axisX[i]*x+mesh.axisY[i]*y) as [number,number,number];
        const cameraPoint=terrainCameraPoint(hud.camera,world);if(cameraPoint[2]<=0)continue;
        const anchor=terrainProject(terrain.intrinsics,cameraPoint);
        if(anchor.some(value=>value<0||value>1))continue;
        // Include the projected footprint extent, not only its centre.
        for(const side of [-1,1])for(const end of [-1,1]){
          const cx=x+Math.cos(angle)*side*placement.width*.5-Math.sin(angle)*end*placement.height*.5;
          const cy=y+Math.sin(angle)*side*placement.width*.5+Math.cos(angle)*end*placement.height*.5;
          const edge=mesh.origin.map((v,i)=>v+mesh.axisX[i]*cx+mesh.axisY[i]*cy) as [number,number,number];
          const point=terrainCameraPoint(hud.camera,edge);
          if(point[2]>0)groundTop=Math.min(groundTop,terrainProject(terrain.intrinsics,point)[1]);
        }
        cards.push([...anchor,candidate.age,candidate.blueDuration,candidate.index,d.confidence,placement.side==='left'?1:2,candidate.opacity*(candidate.rejected?-1:1)]);
        }
      }
      for(const card of cards){
        data.set([...card,...placeAnalysisCard(card,cardOrigins,groundTop),0,0],236+count*12);
        count++;
      }
      data[234]=count;
    }
    const uniform=this.device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.UNIFORM,mappedAtCreation:true});new Float32Array(uniform.getMappedRange()).set(data);uniform.unmap();
    this.copyShadow??=this.device.createTexture({size:[1,1],format:'depth32float',usage:GPUTextureUsage.TEXTURE_BINDING});
    const group=this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:sampler},{binding:2,resource:input},{binding:3,resource:this.copyShadow.createView()}]});
    const pass=encoder.beginRenderPass({colorAttachments:[{view:output,loadOp:'clear',storeOp:'store'}]});pass.setPipeline(hud?this.hudPipeline:this.copyPipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
  }
  destroy(){for(const geometry of this.meshes.values()){geometry.buffer.destroy();geometry.shadow.destroy();}for(const depth of this.depths.values())depth.destroy();for(const texture of this.pathTargets.values())texture.destroy();for(const uniform of this.projectionUniforms.values())uniform.destroy();this.copyShadow?.destroy();this.meshes.clear();this.depths.clear();this.pathTargets.clear();this.projectionUniforms.clear();}
}
