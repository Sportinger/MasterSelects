const STATES=['SCANNING','READING','MATCHED','SYNCING','SAMPLING','RESOLVED'];
const WORDS=['SIGNAL','VECTOR','FIELD','MOTION','PHASE','STRUCTURE','TENSION','RETURN'];
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Readout-only decoration; coordinate values and node identifiers are never scrambled. */
export function changingCurveReadouts(title:string,time:number,card:number,amount:number):{title:string;status:string} {
  if(amount<=0||card%3===2)return {title,status:'SCANNING'};
  const period=2.1+(card%4)*.27,clock=time+card*.67,epoch=Math.floor(clock/period),phase=clock-epoch*period;
  const index=((epoch+card)%STATES.length+STATES.length)%STATES.length;
  let status=STATES[index],nextTitle=title;
  if(card%3===0){
    const prefix=title.split(' ')[0];nextTitle=prefix+' '+WORDS[((epoch*3+card)%WORDS.length+WORDS.length)%WORDS.length];
  }
  const duration=.24*amount;
  if(phase<duration){
    const tick=Math.floor(phase*30),settled=Math.floor(phase/duration*status.length);
    status=[...status].map((c,i)=>i<settled?c:ALPHABET[(card*7+epoch*11+tick*13+i*17+100000)%ALPHABET.length]).join('');
    if(card%3===0){
      const space=nextTitle.indexOf(' '),fixed=Math.floor(phase/duration*(nextTitle.length-space-1));
      nextTitle=[...nextTitle].map((c,i)=>i<=space+fixed?c:ALPHABET[(card*3+epoch*19+tick*7+i*11+100000)%ALPHABET.length]).join('');
    }
  }
  return {title:nextTitle.slice(0,20),status};
}
