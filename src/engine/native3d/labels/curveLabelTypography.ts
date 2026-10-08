/** Low ten bits remain the character/coordinate slot; style bits never change text color. */
const BOLD=2048,AUTHORED_HEADING=4096,ITALIC=8192,PLACED=0x80000000;
interface Word { row:number; start:number; end:number; score:number }
const cache=new Map<string,Uint32Array>();
/** Word emphasis is deterministic; pack advances so enlarged words cannot collide with neighbors. */
export function authoredCurveLabelGlyphs(rows:readonly string[],card:number,variation:number):Uint32Array {
  const glyphs=new Uint32Array(80).fill(32),amount=Math.max(0,Math.min(1,variation));
  const key=`${card}:${amount}:${rows.join('\n')}`,cached=cache.get(key);
  if(cached)return cached;
  const words:Word[]=[];
  rows.forEach((line,row)=>{
    // Headers and machine/data rows retain their fixed columns.
    if(row===0||/[\d:/]/.test(line))return;
    for(const match of line.matchAll(/[A-Za-z][A-Za-z'-]{3,}[!?]*/g)){
      const start=match.index!;
      words.push({row,start,end:start+match[0].length,
        score:Math.min(12,match[0].length)+(/[!?]/.test(match[0])?20:0)+((card*7+row*11+start*3)%7)*.15});
    }
  });
  const ranked=words.toSorted((a,b)=>b.score-a.score||a.row-b.row||a.start-b.start);
  const emphasis=amount>0?ranked.filter((word,index)=>index===0||
    (card%3!==0&&word.row!==ranked[0].row&&ranked.findIndex(other=>other.row===word.row)===index)).slice(0,2):[];
  const italic=amount>0&&card%3===1?words.find(word=>!emphasis.includes(word)):undefined;
  rows.forEach((line,row)=>{
    const decorated=emphasis.some(word=>word.row===row)||italic?.row===row;
    const spans=Array.from(line,(char,col)=>{
      const strong=emphasis.some(word=>word.row===row&&col>=word.start&&col<word.end);
      const slanted=italic?.row===row&&col>=italic.start&&col<italic.end;
      const size=strong?1+.18*amount:slanted?1+.04*amount:1;
      return {char,strong,slanted,size,advance:char===' '&&decorated ? .72 : size};
    });
    const width=spans.reduce((sum,span)=>sum+span.advance,0),fit=Math.min(1,19.9/Math.max(1,width));
    let cursor=0;
    spans.forEach((span,col)=>{
      let code=span.char.charCodeAt(0)+(row===0?BOLD+AUTHORED_HEADING:0)+(span.strong?BOLD:0)+(span.slanted?ITALIC:0);
      if(decorated){
        const scale=Math.max(.75,Math.floor((span.size*fit-.75)*64)/64+.75);
        const advance=span.char===' '?span.advance*fit:scale;
        const center=Math.round((cursor+advance*.5)*64),size=Math.round((scale-.75)*64);
        code=(code|(center<<14)|(size<<25)|PLACED)>>>0;cursor+=advance;
      }
      glyphs[row*20+col]=code;
    });
  });
  cache.set(key,glyphs);if(cache.size>384)cache.delete(cache.keys().next().value!);
  return glyphs;
}
