import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFrameCoalescedDrag } from '../../src/components/timeline/hooks/useFrameCoalescedDrag';
import { animationFrameClock } from '../helpers/animationFrameClock';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { changedKeyframeClipIds, keyframeSnapshot } from '../../src/stores/timeline/editOperations/keyframeTransactionHelpers';
import { applyKeyframeTransactionMutations } from '../../src/stores/timeline/editOperations/keyframeTransactionMutationOperations';
import type { TimelineEditWarning } from '../../src/stores/timeline/editOperations/types';

const initial = useTimelineStore.getState();
beforeEach(() => useTimelineStore.setState(initial, true));
afterEach(() => { vi.restoreAllMocks(); useTimelineStore.setState(initial, true); });
function fixture(count=1) {
  const keys=Array.from({length:count},(_,i)=>createMockKeyframe({id:`k${i}`,clipId:'a',property:'opacity',time:i/count*8,value:.5}));
  const untouched=[createMockKeyframe({id:'other',clipId:'b',property:'opacity',time:0,value:1})];
  useTimelineStore.setState({clips:[createMockClip({id:'a',trackId:'v',duration:10}),createMockClip({id:'b',trackId:'v',duration:10})],
    tracks:[createMockTrack({id:'v'})],clipKeyframes:new Map([['a',keys],['b',untouched]])});
  return {keys,untouched};
}
describe('keyframe interaction work bounds',()=>{
  it.each(['ease-in','ease-out','ease-in-out','bezier'] as const)('preserves %s when re-recording a value and moving its keyframe',easing=>{
    fixture();
    const handles={handleIn:{x:-.2,y:-.1},handleOut:{x:.3,y:.1}};
    useTimelineStore.getState().updateKeyframe('k0',{easing,...handles});
    useTimelineStore.getState().addKeyframe('a','opacity',.8,0);
    useTimelineStore.getState().moveKeyframe('k0',2);
    expect(useTimelineStore.getState().clipKeyframes.get('a')![0]).toMatchObject({id:'k0',value:.8,time:2,easing,...handles});
  });
  it('retains hold on value edits, defaults new keys to linear and honors an explicit easing change',()=>{
    fixture();
    useTimelineStore.getState().updateKeyframe('k0',{hold:true});
    useTimelineStore.getState().addKeyframe('a','opacity',.8,0);
    expect(useTimelineStore.getState().clipKeyframes.get('a')![0].hold).toBe(true);
    useTimelineStore.getState().addKeyframe('a','opacity',.9,0,'ease-in-out');
    expect(useTimelineStore.getState().clipKeyframes.get('a')![0]).toMatchObject({easing:'ease-in-out',hold:undefined});
    useTimelineStore.getState().addKeyframe('a','opacity',1,2);
    expect(useTimelineStore.getState().clipKeyframes.get('a')![1].easing).toBe('linear');
  });
  it('applies a large easing selection with one publication and preserves unrelated clips',()=>{
    const {keys,untouched}=fixture(2000);
    const invalidate=vi.spyOn(useTimelineStore.getState(),'invalidateCache').mockImplementation(()=>{});
    let publications=0;
    const stop=useTimelineStore.subscribe((state,previous)=>{if(state.clipKeyframes!==previous.clipKeyframes)publications++;});
    useTimelineStore.getState().applyKeyframeEasingCurve(keys.map(k=>k.id),null,'ease-in');
    expect(publications).toBe(1);expect(invalidate).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().clipKeyframes.get('b')).toBe(untouched);
    expect(useTimelineStore.getState().clipKeyframes.get('a')!.every(k=>k.easing==='ease-in')).toBe(true);stop();
  });
  it('does not publish unchanged edits or touch other clips for move/value/handle changes',()=>{
    const {untouched}=fixture();
    const invalidate=vi.spyOn(useTimelineStore.getState(),'invalidateCache').mockImplementation(()=>{});
    useTimelineStore.getState().moveKeyframe('k0',2);
    useTimelineStore.getState().updateKeyframe('k0',{value:.8});
    useTimelineStore.getState().updateBezierHandle('k0','out',{x:1,y:.2});
    expect(useTimelineStore.getState().clipKeyframes.get('b')).toBe(untouched);
    const stable=useTimelineStore.getState().clipKeyframes;
    invalidate.mockClear();
    useTimelineStore.getState().moveKeyframe('k0',2);
    useTimelineStore.getState().updateKeyframe('k0',{value:.8});
    useTimelineStore.getState().updateBezierHandle('k0','out',{x:1,y:.2});
    expect(useTimelineStore.getState().clipKeyframes).toBe(stable);expect(invalidate).not.toHaveBeenCalled();
  });
  it('publishes a multi-keyframe transaction once and invalidates once',()=>{
    fixture(50);const invalidate=vi.spyOn(useTimelineStore.getState(),'invalidateCache').mockImplementation(()=>{});
    const set=vi.fn(useTimelineStore.setState);
    const warnings:TimelineEditWarning[]=[];
    applyKeyframeTransactionMutations(Array.from({length:50},(_,i)=>({type:'keyframe-update-value' as const,
      keyframeId:`k${i}`,clipId:'a',property:'opacity' as const,value:{value:.75}})),
      {get:useTimelineStore.getState,set,options:{}},warnings);
    expect(warnings).toEqual([]);expect(set).toHaveBeenCalledTimes(1);expect(invalidate).toHaveBeenCalledTimes(1);
    expect(useTimelineStore.getState().clipKeyframes.get('a')!.every(k=>k.value===.75)).toBe(true);
  });
  it('compares untouched snapshot arrays without serializing their payloads',()=>{
    const {untouched}=fixture();
    Object.defineProperty(untouched[0],'pathValue',{get:()=>{throw new Error('Unrelated path was serialized');}});
    const before=keyframeSnapshot(useTimelineStore.getState().clipKeyframes);
    useTimelineStore.getState().updateKeyframe('k0',{value:.75});
    expect(changedKeyframeClipIds(before,useTimelineStore.getState().clipKeyframes)).toEqual(['a']);
  });
  it('coalesces pointer bursts and commits the last position even before the next animation frame',()=>{
    const frames=animationFrameClock(), move=vi.fn();
    const {result,unmount}=renderHook(()=>useFrameCoalescedDrag(move));
    act(()=>{for(let i=0;i<100;i++)result.current.push(i);});
    expect(move).not.toHaveBeenCalled();expect(frames.count()).toBe(1);
    frames.flush();expect(move).toHaveBeenCalledExactlyOnceWith(99);
    act(()=>{result.current.push(101);result.current.flush();});
    expect(move).toHaveBeenLastCalledWith(101);expect(frames.count()).toBe(0);
    act(()=>result.current.push(102));unmount();frames.flush();expect(move).toHaveBeenCalledTimes(2);
  });
  it('drops cancelled work and uses the latest callback after a rerender',()=>{
    const frames=animationFrameClock(), first=vi.fn(),second=vi.fn();
    const {result,rerender}=renderHook(({move})=>useFrameCoalescedDrag(move),{initialProps:{move:first}});
    result.current.push(1);result.current.cancel();frames.flush();expect(first).not.toHaveBeenCalled();
    result.current.push(2);rerender({move:second});frames.flush();expect(second).toHaveBeenCalledExactlyOnceWith(2);
  });
});
