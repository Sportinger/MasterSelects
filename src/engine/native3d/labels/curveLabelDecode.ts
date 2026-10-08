/** Bounded, deterministic decode frames. Whole graphemes keep combining marks and Indic conjuncts intact. */
export const HEADLINE_DECODE_FRAMES=8;
export const HEADLINE_DECODE_SECONDS=.42;
export function curveLabelDecodeFrames(phrase:string):string[] {
  const clusters=Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(phrase),item=>item.segment);
  const symbols='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?+/#%';
  return Array.from({length:HEADLINE_DECODE_FRAMES},(_,frame)=>{
    const settled=Math.floor(clusters.length*frame/(HEADLINE_DECODE_FRAMES-1));
    return clusters.map((cluster,index)=>index<settled||/^\s+$/.test(cluster)?cluster:
      symbols[(index*17+frame*23+phrase.codePointAt(0)!)%symbols.length]).join('');
  });
}
