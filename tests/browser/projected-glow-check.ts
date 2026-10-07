import { EffectsPipeline } from '../../src/effects/EffectsPipeline';
import { ProjectedLayerEffects } from '../../src/engine/native3d/passes/ProjectedLayerEffects';
const result: Record<string, unknown> = {};
try {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error('No GPU adapter');
  const device = await adapter.requestDevice(); const errors: string[] = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  const effects = new EffectsPipeline(device); await effects.createPipelines(); effects.prewarmEffect('glow');
  const deadline = performance.now() + 10000;
  while (!effects.getEffectPipeline('glow') && performance.now() < deadline) await new Promise(done => setTimeout(done, 20));
  if (!effects.getEffectPipeline('glow')) throw new Error('Glow pipeline not ready');
  const width = 64, height = 64;
  const output = device.createTexture({ size: [width,height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const depth = device.createTexture({ size: [width,height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const shader = device.createShaderModule({ code: `
    @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
      let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
    }
    struct Out { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
    @fragment fn strand(@builtin(position) p:vec4f)->Out {
      if(p.x<30||p.x>34||p.y<18||p.y>46){discard;}
      var o:Out;o.color=vec4f(.5,.5,.5,.5);o.depth=.4;return o;
    }
    @fragment fn background(@builtin(position) p:vec4f)->Out {
      if(p.x>8||p.y>8){discard;}
      var o:Out;o.color=vec4f(0,0,1,1);o.depth=.2;return o;
    }` });
  const pipeline = (entryPoint: string) => device.createRenderPipeline({ layout:'auto',vertex:{module:shader,entryPoint:'vs'},
    fragment:{module:shader,entryPoint,targets:[{format:'rgba16float'}]}, depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'} });
  const strand = pipeline('strand'), background = pipeline('background');
  const projected = new ProjectedLayerEffects();
  const context = { effectsPipeline: effects, sampler: device.createSampler({minFilter:'linear',magFilter:'linear'}), timelineTimeSeconds:0 };
  const half = (bits:number) => { const sign=bits>>15?-1:1, exponent=(bits>>10)&31, mantissa=bits&1023;
    return sign*(exponent===0 ? mantissa*2**-24 : (1+mantissa/1024)*2**(exponent-15)); };
  const frame = async (glow:boolean) => {
    const encoder=device.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],
      depthStencilAttachment:{view:depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}});
    pass.setPipeline(background);pass.draw(3);pass.end();const temporary:GPUBuffer[]=[];
    projected.render('check',device,encoder,output.createView(),depth.createView(),width,height,
      glow?[{id:'glow',type:'glow',name:'Glow',enabled:true,params:{amount:3,threshold:.2,radius:1,softness:.5,rings:3,samplesPerRing:16}}]:[],1,
      (color,depthView)=>{const p=encoder.beginRenderPass({colorAttachments:[{view:color,loadOp:'load',storeOp:'store'}],
        depthStencilAttachment:{view:depthView,depthLoadOp:'load',depthStoreOp:'store'}});p.setPipeline(strand);p.draw(3);p.end();return true;},context,temporary);
    const buffer=device.createBuffer({size:width*height*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    encoder.copyTextureToBuffer({texture:output},{buffer,bytesPerRow:width*8},[width,height]);device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);const pixels=Array.from(new Uint16Array(buffer.getMappedRange()),half);buffer.unmap();buffer.destroy();temporary.forEach(b=>b.destroy());return pixels;
  };
  const plain=await frame(false); let glowing=await frame(true);
  // Graph pipelines compile asynchronously on their first render.
  for(let i=0;i<100 && glowing[(32*width+40)*4+3]===0;i++){await new Promise(done=>setTimeout(done,50));glowing=await frame(true);}
  const pixel=(p:number[],x:number,y:number)=>p.slice((y*width+x)*4,(y*width+x)*4+4);
  const core=pixel(plain,32,32),halo=pixel(glowing,40,32),other=pixel(glowing,4,4);
  if(Math.abs(core[3]-.5)>.01)throw new Error(`Opacity was applied twice: ${core}`);
  if(!(halo[3]>.001&&halo[0]>.001&&pixel(plain,40,32)[3]===0))throw new Error(`Transparent halo missing: ${halo}`);
  if(other[0]!==0||other[1]!==0||other[2]!==1||other[3]!==1)throw new Error(`Unrelated layer changed: ${other}`);
  await device.queue.onSubmittedWorkDone();if(errors.length)throw new Error(errors.join('\n'));
  Object.assign(result,{success:true,core,halo,unrelatedLayer:other,errors});projected.destroy();output.destroy();depth.destroy();
} catch(error){Object.assign(result,{success:false,error:String(error),stack:error instanceof Error?error.stack:null});}
(document.querySelector('#result') as HTMLElement).textContent=JSON.stringify(result,null,2);
const report=new URLSearchParams(location.search).get('report');
if(report)await fetch(report,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
