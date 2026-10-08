/** Zero-based card:strand@material-position entries, independent of card order or curve length. */
export interface CurveLabelAnchorOverride { card:number; strand:number; u:number }
export function parseCurveLabelAnchors(value:string):CurveLabelAnchorOverride[] {
  if(value.length>512)throw new Error('Curve Scan Labels: Anchor Overrides must be at most 512 characters.');
  if(!value.trim())return [];
  const seen=new Set<number>();
  return value.split('|').map(entry=>{
    const match=/^\s*(\d+)\s*:\s*(\d+)\s*@\s*(\d*\.?\d+)\s*$/.exec(entry);
    if(!match)throw new Error('Curve Scan Labels: use card:strand@position entries separated by | (zero-based indices, position 0–1).');
    const card=Number(match[1]),strand=Number(match[2]),u=Number(match[3]);
    if(card>11||strand>65535||!Number.isFinite(u)||u<0||u>1)
      throw new Error('Curve Scan Labels: anchor card must be 0–11, strand 0–65535 and position 0–1.');
    if(seen.has(card))throw new Error('Curve Scan Labels: each card can have only one anchor override.');
    seen.add(card);return {card,strand,u};
  });
}
