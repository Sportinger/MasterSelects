import {parseCurveLabelAnchors} from '../../../services/operators/geometry/curveLabelAnchors';
import {curveLabelLock,curveLabelLockReadouts} from './curveLabelLock';
import {curveLabelEpisode,curveLabelReveal} from './curveLabelSchedule';
import {changingCurveReadouts} from './curveLabelReadout';
import type { CurveLabelSpec } from '../../../services/operators/geometry/curveLabels';
export const LABEL_COLUMNS=20, LABEL_ROWS=4, LABEL_GLYPHS=LABEL_COLUMNS*LABEL_ROWS;
/** Stable topology references; animation positions are read from the GPU, never read back to JS. */
export function curveLabelAnchors(starts:Uint32Array,counts:Uint32Array,spec:CurveLabelSpec,followReleased=false):Float32Array {
  const out=new Float32Array(spec.count*4);
  const overrides=followReleased?[]:parseCurveLabelAnchors(spec.anchorOverrides??'');
  for(let card=0;card<spec.count;card++){
    const total=Math.max(1,starts.length),followers=Math.round(spec.count*spec.followShare);
    const progress=Math.max(0,(spec.releaseProgress-spec.releaseMargin)/(1-spec.releaseMargin));
    const released=Math.min(total-1,Math.floor(progress*(total-1)));
    const destination=card<followers
      ?Math.min(released,Math.floor(card*(total-1)/Math.max(1,followers-1)))
      :Math.max(released,total-1-(card-followers));
    const override=overrides.find(value=>value.card===card);
    const strand=override?override.strand%total:followReleased?destination:(spec.firstStrand+card*spec.strandStep)%total;
    const phase=spec.start+card*spec.step,u=override?.u??(phase<=1?phase:phase%1);
    const point=u*Math.max(0,(counts[strand]??1)-1),index=Math.floor(point);
    out.set([(starts[strand]??0)+index,(starts[strand]??0)+Math.min(index+1,(counts[strand]??1)-1),point-index,strand],card*4);
  }
  return out;
}
/** Initial appearance metadata, retained for consumers laying out an opening sequence. */
export function curveLabelTiming(spec:CurveLabelSpec,card:number):{birth:number;period:number} {
  return curveLabelEpisode(spec,-Infinity,card);
}
export function curveLabelLife(spec:CurveLabelSpec,time:number,card:number):{phase:number;reveal:number} {
  return curveLabelReveal(spec,time,curveLabelEpisode(spec,time,card));
}
/** Coordinate slots (256+) are formatted in the shader from the current world-space anchor. */
export function curveLabelGlyphs(spec:CurveLabelSpec,time:number):Uint32Array {
  const out=new Uint32Array(spec.count*LABEL_GLYPHS).fill(32),titles=spec.titles.toUpperCase().split('|').filter(Boolean);
  const lock=curveLabelLock(spec,time);
  for(let card=0;card<spec.count;card++){
    if(lock?.card===card&&lock.amount>.01){
      curveLabelLockReadouts(lock).forEach((row,r)=>{for(let c=0;c<Math.min(LABEL_COLUMNS,row.length);c++)
        out[card*LABEL_GLYPHS+r*LABEL_COLUMNS+c]=row.charCodeAt(c)+(r===0?2048:0);});
      continue;
    }
    const {cycle}=curveLabelEpisode(spec,time,card);
    const readout=changingCurveReadouts(titles[(cycle+card)%titles.length]??'FIBER TRACK',time,card,spec.textScramble),title=readout.title;
    const rows=[title,`NODE ${String(card+1).padStart(2,'0')}  /  ${readout.status}`,'X +000.00  Y +000.00','Z +000.00  /  LIVE'];
    rows.forEach((row,r)=>{for(let c=0;c<Math.min(LABEL_COLUMNS,row.length);c++)out[card*LABEL_GLYPHS+r*LABEL_COLUMNS+c]=row.charCodeAt(c);});
    if(spec.style==='mixed'){
      const {phase,reveal}=curveLabelLife(spec,time,card);
      const revealed=Math.floor(Math.max(0,Math.min(1,(reveal-.48)/.52))*LABEL_COLUMNS),wordEnd=title.indexOf(' ')<0?title.length:title.indexOf(' ');
      for(let c=0;c<LABEL_COLUMNS;c++){
        const at=card*LABEL_GLYPHS+c;
        if(c>=revealed)out[at]=32;
        else if(c<wordEnd&&phase>1.2&&phase<3.8&&(cycle+card)%3===0)out[at]+=1024;
      }
    }
    if(spec.style==='mixed'&&(cycle+card)%4===0){
      const words=rows.flatMap((row,r)=>[...row.matchAll(/[A-Z]{3,}/g)].map(match=>({row:r,start:match.index!,length:match[0].length})));
      const word=words[(cycle*11+card*7)%words.length];
      if(word)for(let c=word.start;c<Math.min(LABEL_COLUMNS,word.start+word.length);c++){
        const at=card*LABEL_GLYPHS+word.row*LABEL_COLUMNS+c;if(out[at]%1024!==32)out[at]+=2048;
      }
    }
    for(const [axis,row,col] of [[0,2,2],[1,2,13],[2,3,2]])for(let slot=0;slot<7;slot++)
      out[card*LABEL_GLYPHS+row*LABEL_COLUMNS+col+slot]=256+axis*8+slot;
  }
  return out;
}
