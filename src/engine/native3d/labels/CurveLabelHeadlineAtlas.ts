import {curveLabelDecodeFrames} from './curveLabelDecode';
const WIDTH=1024,TILE_WIDTH=512,ROW_HEIGHT=112;
/** Whole-line rasterization keeps Indic shaping intact; texture bounds retain natural letter proportions. */
export class CurveLabelHeadlineAtlas {
  readonly texture:GPUTexture;
  readonly bounds:GPUBuffer;
  readonly sampler:GPUSampler;
  readonly height:number;
  constructor(device:GPUDevice,phrases:readonly string[]){
    const frames=phrases.flatMap(curveLabelDecodeFrames);
    this.height=Math.max(1,Math.ceil(frames.length/2))*ROW_HEIGHT;
    const canvas=new OffscreenCanvas(WIDTH,this.height),ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Curve Scan Labels need a 2D canvas to shape intro titles.');
    const bounds=new Float32Array(Math.max(1,frames.length)*4);
    ctx.fillStyle='white';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    frames.forEach((phrase,row)=>{
      const font=(size:number)=>`900 ${size}px "Noto Sans", "Noto Sans Devanagari", sans-serif`;
      ctx.font=font(68);const initial=ctx.measureText(phrase);
      const size=Math.min(68,68*(TILE_WIDTH-32)/Math.max(1,initial.width),68*(ROW_HEIGHT-12)/Math.max(1,initial.actualBoundingBoxAscent+initial.actualBoundingBoxDescent));ctx.font=font(size);
      const m=ctx.measureText(phrase),left=m.actualBoundingBoxLeft,right=m.actualBoundingBoxRight;
      const ascent=m.actualBoundingBoxAscent,descent=m.actualBoundingBoxDescent;
      const width=left+right,height=ascent+descent;
      const x=(row%2)*TILE_WIDTH+(TILE_WIDTH-width)/2,y=Math.floor(row/2)*ROW_HEIGHT+(ROW_HEIGHT-height)/2;
      ctx.fillText(phrase,x+left,y+ascent);
      const pad=3;
      bounds.set([(x-pad)/WIDTH,(y-pad)/this.height,(width+2*pad)/WIDTH,(height+2*pad)/this.height],row*4);
    });
    this.texture=device.createTexture({label:'curve-label-intro-phrases',size:[WIDTH,this.height],format:'rgba8unorm',
      usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    device.queue.copyExternalImageToTexture({source:canvas},{texture:this.texture},[WIDTH,this.height]);
    this.bounds=device.createBuffer({label:'curve-label-intro-bounds',size:bounds.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
    device.queue.writeBuffer(this.bounds,0,bounds);
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
  }
  dispose():void{this.texture.destroy();this.bounds.destroy();}
}
/** Retire replaced atlases only after their command encoder was submitted, including multiple scene layers. */
export class CurveLabelHeadlineCache {
  private readonly entries=new Map<string,CurveLabelHeadlineAtlas>();
  private retired:CurveLabelHeadlineAtlas[]=[];
  get(device:GPUDevice,phrases:readonly string[]):CurveLabelHeadlineAtlas {
    const key=JSON.stringify(phrases);let atlas=this.entries.get(key);
    if(atlas){this.entries.delete(key);this.entries.set(key,atlas);return atlas;}
    atlas=new CurveLabelHeadlineAtlas(device,phrases);this.entries.set(key,atlas);
    if(this.entries.size>8){const first=this.entries.keys().next().value!;this.retired.push(this.entries.get(first)!);this.entries.delete(first);}
    return atlas;
  }
  afterSubmit():void{for(const atlas of this.retired)atlas.dispose();this.retired=[];}
  dispose():void{for(const atlas of this.entries.values())atlas.dispose();this.entries.clear();this.afterSubmit();}
}
