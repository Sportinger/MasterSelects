import type { CurveLabelSpec } from '../../../services/operators/geometry/curveLabels';
export const LABEL_COLUMNS=20, LABEL_ROWS=4, LABEL_GLYPHS=LABEL_COLUMNS*LABEL_ROWS;
/** Stable topology references; animation positions are read from the GPU, never read back to JS. */
export function curveLabelAnchors(starts:Uint32Array,counts:Uint32Array,spec:CurveLabelSpec):Float32Array {
  const out=new Float32Array(spec.count*4);
  for(let card=0;card<spec.count;card++){
    const strand=(spec.firstStrand+card*spec.strandStep)%Math.max(1,starts.length);
    const phase=spec.start+card*spec.step,u=phase<=1?phase:phase%1;
    const point=u*Math.max(0,(counts[strand]??1)-1),index=Math.floor(point);
    out.set([(starts[strand]??0)+index,(starts[strand]??0)+Math.min(index+1,(counts[strand]??1)-1),point-index,strand],card*4);
  }
  return out;
}
/** Coordinate slots (256+) are formatted in the shader from the current world-space anchor. */
export function curveLabelGlyphs(spec:CurveLabelSpec,time:number):Uint32Array {
  const out=new Uint32Array(spec.count*LABEL_GLYPHS).fill(32),titles=spec.titles.toUpperCase().split('|').filter(Boolean);
  for(let card=0;card<spec.count;card++){
    const cycle=Math.floor(time/spec.cycle+card*.173),title=titles[(cycle+card)%titles.length]??'FIBER TRACK';
    const rows=[title,`NODE ${String(card+1).padStart(2,'0')}  /  SCANNING`,'X +000.00  Y +000.00','Z +000.00  /  LIVE'];
    rows.forEach((row,r)=>{for(let c=0;c<Math.min(LABEL_COLUMNS,row.length);c++)out[card*LABEL_GLYPHS+r*LABEL_COLUMNS+c]=row.charCodeAt(c);});
    if(spec.style==='mixed'){
      const phase=(time/spec.cycle+card*.173)%1*spec.cycle;
      const revealed=Math.floor(phase*32),wordEnd=title.indexOf(' ')<0?title.length:title.indexOf(' ');
      for(let c=0;c<LABEL_COLUMNS;c++){
        const at=card*LABEL_GLYPHS+c;
        if(c>=revealed)out[at]=32;
        else if(c<wordEnd&&phase>1.2&&phase<3.8&&(cycle+card)%3===0)out[at]+=1024;
      }
    }
    for(const [axis,row,col] of [[0,2,2],[1,2,13],[2,3,2]])for(let slot=0;slot<7;slot++)
      out[card*LABEL_GLYPHS+row*LABEL_COLUMNS+col+slot]=256+axis*8+slot;
  }
  return out;
}
