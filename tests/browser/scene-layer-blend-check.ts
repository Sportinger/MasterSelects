import { StrandProjectedEffects } from '../../src/engine/native3d/sceneRenderer/StrandProjectedEffects';
import { FlockLayerComposite } from '../../src/engine/flock/gpu/FlockLayerComposite';
import type { StrandPass, StrandShadowFrame } from '../../src/engine/native3d/passes/StrandPass';
import type { FlockDrawPlan } from '../../src/engine/flock/gpu/FlockBranchRenderer';
import type { SceneCamera } from '../../src/engine/scene/types';

// GPU integration fixture: the real strand routing/compositor with a synthetic depth-tested fiber surface.
const results: Record<string, unknown> = {};
try {
  const adapter = await navigator.gpu.requestAdapter(); if (!adapter) throw new Error('No GPU adapter');
  const device = await adapter.requestDevice(); device.pushErrorScope('validation');
  const size = 32, buffers: GPUBuffer[] = [];
  const color = device.createTexture({size:[size,size],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});
  const depth = device.createTexture({size:[size,size],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  const shader = device.createShaderModule({code:`
    @vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
      let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
    }
    struct Out { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
    @fragment fn fragment(@builtin(position) p:vec4f)->Out {
      if(p.x<8||p.x>=24){discard;}
      var o:Out;o.color=vec4f(.3,.05,.1,.5);o.depth=.4;return o;
    }`});
  const pipeline = device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vertex'},
    fragment:{module:shader,entryPoint:'fragment',targets:[{format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'}});
  const pass = {render: (_device:GPUDevice,encoder:GPUCommandEncoder,view:GPUTextureView,z:GPUTextureView,frame:StrandShadowFrame) => {
    if(!frame.draws.length)return true;
    const draw=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'load',storeOp:'store'}],depthStencilAttachment:{view:z,depthLoadOp:'load',depthStoreOp:'store'}});
    draw.setPipeline(pipeline);draw.draw(3);draw.end();return true;
  }} as unknown as StrandPass;
  const camera={viewport:{width:size,height:size}} as SceneCamera;
  const strands=new StrandProjectedEffects(),flock=new FlockLayerComposite();
  const half=(bits:number)=>{const e=(bits>>10)&31,m=bits&1023;return(bits>>15?-1:1)*(e===0?m*2**-24:(1+m/1024)*2**(e-15));};
  for(const renderer of ['strands','flock'] as const) for(const mode of ['normal','multiply','screen','difference'] as const) for(const occluded of [false,true]) {
    const encoder=device.createCommandEncoder(), view=color.createView(), z=depth.createView();
    const clear=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:[.2,.4,.6,1]}],
      depthStencilAttachment:{view:z,depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:occluded?.2:1}});clear.end();
    const frame={draws:[{layer:{layerId:'fiber',blendMode:mode,opacity:.5}}],targets:[{}]} as unknown as StrandShadowFrame;
    if(renderer==='strands')strands.render('test',pass,device,encoder,view,z,frame,camera,buffers);
    else {
      const isolated=flock.begin(device,encoder,view,size,size);pass.render(device,encoder,isolated,z,frame,camera,buffers);
      flock.end(encoder,view,{layer:{blendMode:mode,opacity:1},session:{step:0},program:{stepRate:60}} as FlockDrawPlan,buffers);
    }
    const read=device.createBuffer({size:size*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    encoder.copyTextureToBuffer({texture:color},{buffer:read,bytesPerRow:256},[size,size]);device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);const pixels=Array.from(new Uint16Array(read.getMappedRange()),half);read.unmap();read.destroy();
    const pixel=(x:number)=>pixels.slice((16*size+x)*4,(16*size+x)*4+4);
    const expected=occluded?[.2,.4,.6,1]:({normal:[.4,.25,.4,1],multiply:[.16,.22,.36,1],screen:[.44,.43,.64,1],difference:[.3,.35,.5,1]})[mode];
    const actual=pixel(16);if(!expected.every((v,i)=>Math.abs(v-actual[i])<.004))throw new Error(`${renderer}/${mode}/${occluded}: ${actual}`);
    if(![.2,.4,.6,1].every((v,i)=>Math.abs(v-pixel(2)[i])<.004))throw new Error('Pixels outside the layer changed');
    results[`${renderer}/${mode}/${occluded?'behind':'front'}`]=actual;
  }
  const error=await device.popErrorScope();if(error)throw new Error(error.message);
  buffers.forEach(b=>b.destroy());strands.destroy();flock.dispose();color.destroy();depth.destroy();device.destroy();
  Object.assign(results,{success:true,cases:16});
} catch(error) {Object.assign(results,{success:false,error:String(error)});}
document.querySelector('#result')!.textContent=JSON.stringify(results,null,2);
document.title=results.success?'PASS · Scene layer blending':'FAIL · Scene layer blending';
const report=new URLSearchParams(location.search).get('report');
if(report&&/^http:\/\/(localhost|127\.0\.0\.1):\d+\/$/.test(report))await fetch(report,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(results)});
