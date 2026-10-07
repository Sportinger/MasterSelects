/** Small monochrome atlas with mono, sans, serif and bold accent faces, created once per GPU device; never stored in project data. */
export class CurveLabelAtlas {
  readonly texture:GPUTexture;
  readonly sampler:GPUSampler;
  constructor(device:GPUDevice){
    const canvas=new OffscreenCanvas(384,960),ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Curve Scan Labels need a software 2D canvas for the glyph atlas.');
    ctx.clearRect(0,0,384,960);ctx.fillStyle='white';ctx.font='28px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ['28px monospace','28px sans-serif','bold 28px serif','bold 28px sans-serif'].forEach((font,face)=>{
      ctx.font=font;
      for(let glyph=0;glyph<96;glyph++)ctx.fillText(String.fromCharCode(32+glyph),(glyph%16)*24+12,(face*6+Math.floor(glyph/16))*40+20,22);
    });
    this.texture=device.createTexture({label:'curve-label-glyphs',size:[384,960],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    device.queue.copyExternalImageToTexture({source:canvas},{texture:this.texture},[384,960]);
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
  }
  dispose():void{this.texture.destroy();}
}
