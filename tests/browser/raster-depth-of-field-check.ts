import { RasterDepthOfField } from '../../src/engine/native3d/sceneRenderer/rasterDepthOfField';
import { FlockLayerComposite } from '../../src/engine/flock/gpu/FlockLayerComposite';
import { perspective } from '../../src/engine/scene/cameraUtils/projectionMatrices';
import type { SceneCamera } from '../../src/engine/scene/types';
import type { FlockDrawPlan } from '../../src/engine/flock/gpu/FlockBranchRenderer';

// Synthetic thin fibers isolate depth filtering from the user's project, animation and camera.
const result = document.querySelector('#result')!;
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const metrics: Record<string, unknown> = {};
try {
  const adapter = await navigator.gpu.requestAdapter();
  assert(!!adapter, 'WebGPU adapter missing');
  const device = await adapter!.requestDevice();
  device.pushErrorScope('validation');
  const size = 64;
  const texture = (format: GPUTextureFormat) => device.createTexture({ size: [size, size], format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  const hdr = texture('rgba16float'), depth = texture('depth24plus'), output = texture('rgba8unorm');
  const module = device.createShaderModule({ code: `
    @vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
      let p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.)); return vec4f(p[i],0.,1.); }
    struct O { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
    @fragment fn fiber(@builtin(position) p:vec4f)->O {
      var o:O; let strand = u32(p.x)==32u;
      o.color=select(vec4f(0.),vec4f(1.),strand);
      o.depth=select(1.,(1000./999.9)-(100./999.9)/2.,strand); return o; }
    @group(0) @binding(0) var image:texture_2d<f32>;
    @fragment fn copy(@builtin(position) p:vec4f)->@location(0) vec4f { return textureLoad(image,vec2i(p.xy),0); }
  ` });
  const draw = device.createRenderPipeline({ layout:'auto', vertex:{ module, entryPoint:'vertex' },
    fragment:{module,entryPoint:'fiber',targets:[{format:'rgba16float'}]},
    depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'always'} });
  const copy = device.createRenderPipeline({ layout:'auto', vertex:{module,entryPoint:'vertex'},
    fragment:{module,entryPoint:'copy',targets:[{format:'rgba8unorm'}]} });
  const read = async (encoder: GPUCommandEncoder, view: GPUTextureView) => {
    const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store'}]});
    pass.setPipeline(copy); pass.setBindGroup(0,device.createBindGroup({layout:copy.getBindGroupLayout(0),entries:[{binding:0,resource:view}]}));
    pass.draw(3);pass.end();
    const buffer=device.createBuffer({size:size*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    encoder.copyTextureToBuffer({texture:output},{buffer,bytesPerRow:256},[size,size]);device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(buffer.getMappedRange().slice(0));buffer.unmap();buffer.destroy();return pixels;
  };
  const camera = { cameraPosition:{x:0,y:0,z:10},cameraTarget:{x:0,y:0,z:0},fov:30,projection:'perspective',
    projectionMatrix:perspective(Math.PI/6,1,.1,1000),viewport:{width:size,height:size},
    lens:{fStop:.001,focusDistance:10} } as SceneCamera;
  const dof = new RasterDepthOfField();
  const run = async (focusDistance:number, fStop=.001) => {
    const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:hdr.createView(),loadOp:'clear',storeOp:'store'}],
      depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
    pass.setPipeline(draw);pass.draw(3);pass.end();
    const view=dof.render(device,encoder,'test',hdr.createView(),depth.createView(),{...camera,lens:{...camera.lens!,focusDistance,fStop}},'raster');
    return read(encoder,view);
  };
  const off=await run(10,0), focused=await run(2), blurred=await run(10);
  const px=(a:Uint8Array,x:number)=>a[(32*size+x)*4]/255;
  metrics.fiber={off:px(off,32),focused:px(focused,32),blurred:px(blurred,32),halo:px(blurred,35),focusedHalo:px(focused,35)};
  assert(px(off,32)>.99 && px(focused,32)>.98, 'Focused fiber lost sharpness');
  assert(px(focused,35)<.01, 'Focused occluder leaked into the background');
  assert(px(blurred,32)<.5, 'Defocused thin fiber stayed sharp');
  assert(px(blurred,35)>.003, 'Defocused fiber failed to spread into clear pixels');
  const composite = new FlockLayerComposite();const buffers:GPUBuffer[]=[];
  const blends:Record<string,number[]>={};
  for(const mode of ['normal','multiply','screen','difference'] as const){
    const encoder=device.createCommandEncoder();
    const base=encoder.beginRenderPass({colorAttachments:[{view:hdr.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:.2,g:.4,b:.6,a:1}}]});base.end();
    const view=composite.begin(device,encoder,hdr.createView(),size,size);
    const fg=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:.6,g:.1,b:.2,a:1}}]});fg.end();
    composite.end(encoder,hdr.createView(),{layer:{blendMode:mode,opacity:.5},session:{step:0},program:{stepRate:60}} as FlockDrawPlan,buffers);
    const pixels=await read(encoder,hdr.createView());blends[mode]=Array.from(pixels.slice(0,3),x=>x/255);
  }
  metrics.blends=blends;
  const validation=await device.popErrorScope();assert(!validation,validation?.message??'GPU validation failed');
  for(const [mode,expected] of Object.entries({normal:[.4,.25,.4],multiply:[.16,.22,.36],screen:[.44,.43,.64],difference:[.3,.35,.5]})){
    assert(expected.every((v,i)=>Math.abs(v-blends[mode][i])<.012), `${mode} blend or opacity is incorrect`);
  }
  buffers.forEach(b=>b.destroy());composite.dispose();dof.dispose();hdr.destroy();depth.destroy();output.destroy();device.destroy();
  result.textContent=JSON.stringify({status:'PASS',...metrics},null,2);
} catch(error) { result.textContent=JSON.stringify({status:'FAIL',error:String(error),...metrics},null,2); }
document.title=result.textContent.includes('"PASS"')?'PASS · Raster lens GPU':'FAIL · Raster lens GPU';
// Optional local-only receiver for an agent driving normal Chrome, without browser debugging flags.
const report=new URL(location.href).searchParams.get('report');
if(report && /^http:\/\/(localhost|127\.0\.0\.1):\d+\/result$/.test(report)) {
  await fetch(report,{method:'POST',headers:{'Content-Type':'text/plain'},body:result.textContent});
}
