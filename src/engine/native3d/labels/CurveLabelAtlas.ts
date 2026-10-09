/** High-density monochrome glyphs: medium mono/sans, italic serif, bold sans and bold italic serif. */
export class CurveLabelAtlas {
  readonly texture:GPUTexture;
  readonly sampler:GPUSampler;
  constructor(device:GPUDevice){
    const width=768,height=2400,cellWidth=48,cellHeight=80;
    const canvas=new OffscreenCanvas(width,height),ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Curve Scan Labels need a software 2D canvas for the glyph atlas.');
    ctx.clearRect(0,0,width,height);ctx.fillStyle='white';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    ['600 SIZEpx monospace','600 SIZEpx sans-serif','italic 600 SIZEpx serif',
      '800 SIZEpx sans-serif','italic 800 SIZEpx serif'].forEach((font,face)=>{
      ctx.font=font.replace('SIZE','56');
      const reference=ctx.measureText('Hg');
      const ascent=reference.fontBoundingBoxAscent??reference.actualBoundingBoxAscent;
      const descent=reference.fontBoundingBoxDescent??reference.actualBoundingBoxDescent;
      for(let glyph=0;glyph<96;glyph++){
        const char=String.fromCharCode(32+glyph),m=ctx.measureText(char);
        const left=m.actualBoundingBoxLeft,right=m.actualBoundingBoxRight,ink=left+right;
        const fit=Math.min(1,(cellWidth-6)/Math.max(1,ink));
        // Fit italic overhang horizontally while retaining a shared baseline for punctuation.
        const x=(glyph%16)*cellWidth+(cellWidth-ink*fit)*.5+left*fit;
        const y=(face*6+Math.floor(glyph/16))*cellHeight+(cellHeight-ascent-descent)*.5+ascent;
        ctx.save();ctx.translate(x,y);ctx.scale(fit,1);ctx.fillText(char,0,0);ctx.restore();
      }
    });
    this.texture=device.createTexture({label:'curve-label-glyphs',size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    device.queue.copyExternalImageToTexture({source:canvas},{texture:this.texture},[width,height]);
    this.sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
  }
  dispose():void{this.texture.destroy();}
}
