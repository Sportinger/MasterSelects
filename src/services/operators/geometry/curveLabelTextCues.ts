/** Authored content only: cue times never change tracking, card lifetimes or sound events. */
export interface CurveLabelTextHeadline { text:string; header:string; footer:string }
export interface CurveLabelTextCue {
  start:number;
  end:number;
  panels:string[][];
  headlines?:CurveLabelTextHeadline[];
}
const cache=new Map<string,readonly CurveLabelTextCue[]>();
const fail=(detail:string):never=>{throw new Error(`Curve Scan Labels: Text Cues ${detail}`);};
function line(value:unknown):value is string {
  return typeof value==='string'&&value.length<=20&&/^[\x20-\x7e]*$/.test(value);
}
/** Strict bounded JSON avoids truncating authored words or accepting misspelled fields. */
export function parseCurveLabelTextCues(value:string):readonly CurveLabelTextCue[] {
  if(!value.trim())return [];
  const cached=cache.get(value);if(cached)return cached;
  if(value.length>32768)fail('must fit in 32,768 characters.');
  let raw:unknown;
  try{raw=JSON.parse(value);}catch{fail('must be a JSON array.');}
  if(!Array.isArray(raw)||raw.length>64)fail('must contain at most 64 cues.');
  let previousEnd=0;
  for(const item of raw as unknown[]){
    if(!item||typeof item!=='object'||Array.isArray(item))fail('entries must be objects.');
    const cue=item as Record<string,unknown>;
    if(Object.keys(cue).some(key=>!['start','end','panels','headlines'].includes(key)))fail('contain an unknown cue field.');
    if(typeof cue.start!=='number'||!Number.isFinite(cue.start)||cue.start<previousEnd||
      typeof cue.end!=='number'||!Number.isFinite(cue.end)||cue.end<=cue.start||cue.end>36000)
      fail('need ordered, non-overlapping start/end seconds between 0 and 36,000.');
    previousEnd=cue.end as number;
    if(!Array.isArray(cue.panels)||!cue.panels.length||cue.panels.length>12||cue.panels.some(panel=>
      !Array.isArray(panel)||panel.length!==4||panel.some(row=>!line(row))))
      fail('need 1–12 panels, each with exactly four ASCII rows of at most 20 characters.');
    if(cue.headlines!==undefined){
      if(!Array.isArray(cue.headlines)||cue.headlines.length>2)fail('support at most two simultaneous headlines.');
      for(const item of cue.headlines as unknown[]){
        if(!item||typeof item!=='object'||Array.isArray(item))fail('headlines must be objects.');
        const h=item as Record<string,unknown>;
        if(Object.keys(h).some(key=>!['text','header','footer'].includes(key))||
          typeof h.text!=='string'||!h.text.trim()||[...h.text].length>32||/[\x00-\x1f\x7f]/.test(h.text)||!line(h.header)||!line(h.footer))
          fail('headlines need printable Unicode text (1–32 characters) and ASCII header/footer rows (up to 20).');
      }
    }
  }
  const cues=raw as CurveLabelTextCue[];
  cache.set(value,cues);if(cache.size>16)cache.delete(cache.keys().next().value!);
  return cues;
}
export function activeCurveLabelTextCue(value:string,time:number):CurveLabelTextCue|undefined {
  return parseCurveLabelTextCues(value).find(cue=>time>=cue.start&&time<cue.end);
}
