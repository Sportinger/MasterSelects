import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { CurveEditor } from '../../src/components/timeline/CurveEditor';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { applyKeyframeTransactionMutations } from '../../src/stores/timeline/editOperations/keyframeTransactionMutationOperations';
import type { TimelineEditWarning } from '../../src/stores/timeline/editOperations/types';
const settle = () => new Promise<void>(resolve => setTimeout(resolve,30));
const assert = (value: boolean, message: string) => { if (!value) throw new Error(message); };
const fixture=document.querySelector('#fixture')!;
const result=document.querySelector('#result')!;
const keys=[createMockKeyframe({id:'left',clipId:'a',property:'opacity',time:0,value:.3,easing:'bezier'}),
  createMockKeyframe({id:'right',clipId:'a',property:'opacity',time:2,value:.7})];
const unrelated=Array.from({length:10000},(_,i)=>createMockKeyframe({id:`u${i}`,clipId:'b',time:i/1000,value:1}));
useTimelineStore.setState({clips:[createMockClip({id:'a',trackId:'v',duration:10}),createMockClip({id:'b',trackId:'v',duration:10})],
  tracks:[createMockTrack({id:'v'})],clipKeyframes:new Map([['a',keys],['b',unrelated]])});
let updates=0,commits=0,publications=0;
let lastPosition:unknown;
const stop=useTimelineStore.subscribe((s,p)=>{if(s.clipKeyframes!==p.clipKeyframes)publications++;});
function Fixture(){
  const current=useTimelineStore(s=>s.clipKeyframes.get('a')!);
  return <CurveEditor trackId="v" clipId="a" property="opacity" keyframes={current} clipStartTime={0}
    clipDuration={10} width={800} heightOverride={250} selectedKeyframeIds={new Set(['left'])}
    timeToPixel={t=>t*100} pixelToTime={x=>x/100} onSelectKeyframe={()=>{}} onMoveKeyframe={()=>{}}
    onUpdateBezierHandle={(id,handle,position,phase)=>{
      if(phase==='commit'){commits++;lastPosition=position;return;}
      if(phase==='update')updates++;
      useTimelineStore.getState().updateBezierHandle(id,handle,position);
    }}/>;
}
const renderErrors:string[]=[];
flushSync(()=>createRoot(fixture,{onUncaughtError:error=>renderErrors.push(String(error))}).render(<Fixture/>));
const metrics:Record<string,unknown>={};
try{
  for(let attempt=0;attempt<100&&!fixture.querySelector('.curve-editor-handle');attempt++) {
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  const handle=fixture.querySelector('.curve-editor-handle')!;
  assert(!!handle,`Bezier handle did not render: ${renderErrors.join('; ')} ${fixture.innerHTML.slice(0,500)}`);
  const rect=handle.getBoundingClientRect();
  flushSync(()=>handle.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,buttons:1,clientX:rect.x,clientY:rect.y})));
  await settle();
  publications=0;const started=performance.now();
  for(let i=0;i<100;i++)window.dispatchEvent(new MouseEvent('mousemove',{buttons:1,clientX:rect.x+20+i/2,clientY:rect.y+20,bubbles:true}));
  assert(updates===0,'Pointer burst synchronously published every mouse move');
  window.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
  await settle();
  metrics.drag={pointerEvents:100,updates,commits,publications,lastPosition,elapsedMs:performance.now()-started};
  assert(updates===1&&commits===1&&publications===1,'Last pointer update was dropped or published repeatedly');
  assert(useTimelineStore.getState().clipKeyframes.get('b')===unrelated,'Drag replaced unrelated curves');
  publications=0;let start=performance.now();
  useTimelineStore.getState().applyKeyframeEasingCurve(unrelated.map(k=>k.id),null,'ease-in');
  metrics.easing={keys:unrelated.length,publications,elapsedMs:performance.now()-start};
  assert(publications===1,'Bulk easing published per key');
  assert(useTimelineStore.getState().clipKeyframes.get('b')!.every(k=>k.easing==='ease-in'),'Bulk easing missed keys');
  publications=0;start=performance.now();const warnings:TimelineEditWarning[]=[];
  applyKeyframeTransactionMutations(Array.from({length:100},(_,i)=>({type:'keyframe-update-value' as const,
    keyframeId:`u${i}`,clipId:'b',property:'opacity' as const,value:{value:.5}})),
    {get:useTimelineStore.getState,set:useTimelineStore.setState,options:{}},warnings);
  metrics.transaction={keys:100,publications,elapsedMs:performance.now()-start};
  assert(!warnings.length&&publications===1,'Transaction did not publish atomically');
  result.textContent=JSON.stringify({status:'PASS',...metrics},null,2);
}catch(error){result.textContent=JSON.stringify({status:'FAIL',error:String(error),...metrics},null,2);}
stop();document.title=result.textContent.includes('"PASS"')?'PASS · Keyframe interaction':'FAIL · Keyframe interaction';
const report=new URL(location.href).searchParams.get('report');
if(report&&/^http:\/\/(localhost|127\.0\.0\.1):\d+\/result$/.test(report))await fetch(report,{method:'POST',body:result.textContent});
