export interface StrandIdTopology { clipId:string; layerId:string; starts:Uint32Array; counts:Uint32Array }
export interface StrandIdFrame { width:number; height:number; time:number; targetKey:string; pixels:Uint32Array; layers:StrandIdTopology[] }
export interface StrandPixelHit { x:number; y:number; clipId:string; layerId:string; strand:number; u:number; point:number; fraction:number }
const floatBits=new DataView(new ArrayBuffer(4));

/** Decode the integer attachment, never the display PNG: filtering/lighting cannot corrupt IDs. */
export function strandPixelHit(frame:StrandIdFrame,x:number,y:number):StrandPixelHit|null {
  if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=frame.width||y>=frame.height)return null;
  const i=(y*frame.width+x)*4,layer=frame.layers[frame.pixels[i+3]-1],strand=frame.pixels[i+2]-1,point=frame.pixels[i]-1;
  if(!layer||strand<0||strand>=layer.starts.length)return null;
  floatBits.setUint32(0,frame.pixels[i+1],true);const fraction=floatBits.getFloat32(0,true);
  const start=layer.starts[strand],count=layer.counts[strand];
  if(!Number.isFinite(fraction)||fraction<0||fraction>1||point<start||point>=start+count-1)return null;
  return {x,y,clipId:layer.clipId,layerId:layer.layerId,strand,u:(point-start+fraction)/Math.max(1,count-1),point,fraction};
}

/** Hue distinguishes strands; alternating material bands and brightness show position along each one. */
export function strandIdColors(frame:StrandIdFrame):Uint8ClampedArray {
  const rgba=new Uint8ClampedArray(frame.width*frame.height*4);
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
    const hit=strandPixelHit(frame,x,y),i=(y*frame.width+x)*4;rgba[i+3]=255;if(!hit)continue;
    const h=((hit.strand*.61803398875)%1)*6,c=.62+(Math.floor(hit.u*64)%2)*.38;
    const rgb=[0,1,2].map(channel=>Math.max(0,Math.min(1,Math.abs(((h+[0,4,2][channel])%6)-3)-1)));
    for(let channel=0;channel<3;channel++)rgba[i+channel]=Math.round(255*(.15+.85*rgb[channel])*c);
  }
  return rgba;
}

/** Bounded, spatially separated visible suggestions. Picking is material-based, not a world-space pin. */
export function visibleStrandCandidates(frame:StrandIdFrame,limit=24):Array<StrandPixelHit&{visiblePixels:number}> {
  const bins=new Map<string,{hit:StrandPixelHit;count:number;score:number}>();
  for(let y=1;y<frame.height-1;y++)for(let x=1;x<frame.width-1;x++){
    const hit=strandPixelHit(frame,x,y);if(!hit)continue;
    const key=`${hit.layerId}:${hit.strand}:${Math.floor(hit.u*128)}`;
    const center=Math.hypot(x/frame.width-.5,y/frame.height-.5);
    const prior=bins.get(key);
    if(prior){prior.count++;if(center<prior.score){prior.hit=hit;prior.score=center;}}
    else bins.set(key,{hit,count:1,score:center});
  }
  const chosen:Array<StrandPixelHit&{visiblePixels:number}>=[];
  for(const bin of [...bins.values()].toSorted((a,b)=>b.count-a.count||a.score-b.score)){
    if(chosen.some(p=>Math.hypot((p.x-bin.hit.x)/frame.width,(p.y-bin.hit.y)/frame.height)<.065))continue;
    chosen.push({...bin.hit,visiblePixels:bin.count});if(chosen.length>=Math.max(1,Math.min(32,limit)))break;
  }
  return chosen;
}
