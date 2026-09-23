import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ObjectTrackingOverlay } from '../../src/components/preview/tracking/ObjectTrackingOverlay';
import { useTrackingEditorStore } from '../../src/stores/trackingEditorStore';
const initial=useTrackingEditorStore.getState();
const points=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}];
afterEach(()=>{cleanup();useTrackingEditorStore.setState(initial);});
function setup(tool:'pick-object'|'object'|'inspect',busy=false){
  useTrackingEditorStore.setState({tool,actionBusy:busy,objectPrompts:[],objectSubtract:false});
  const view=render(<ObjectTrackingOverlay points={points} width={100} height={100} disabled={false} toSource={p=>p} toComposition={p=>p}/>);
  const svg=view.container.querySelector('svg')!;
  svg.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100,right:100,bottom:100,x:0,y:0,toJSON:()=>({})});
  return svg;
}
it('collects every rapid include/exclude click even while the current inference is busy',()=>{
  const svg=setup('pick-object',true);
  for(let i=0;i<100;i++)fireEvent(svg,new MouseEvent('pointerdown',{bubbles:true,clientX:25,clientY:30,ctrlKey:i%2===1}));
  const prompts=useTrackingEditorStore.getState().objectPrompts;
  expect(prompts).toHaveLength(100);
  expect(prompts[0]).toEqual({x:.25,y:.3,label:1});expect(prompts[99].label).toBe(0);
  expect(document.activeElement).not.toBe(svg);
});
it('supports keyboard selection and touch subtraction without a modifier key',()=>{
  const svg=setup('pick-object');
  fireEvent.keyDown(svg,{key:'ArrowRight'});fireEvent.keyDown(svg,{key:'Enter'});
  expect(useTrackingEditorStore.getState().objectPrompts[0]).toEqual({x:.51,y:.5,label:1});
  act(()=>useTrackingEditorStore.setState({objectSubtract:true}));
  fireEvent(svg,new MouseEvent('pointerdown',{bubbles:true,clientX:40,clientY:20}));
  expect(useTrackingEditorStore.getState().objectPrompts[1]).toEqual({x:.4,y:.2,label:0});
});
it('adds a contour point from a keyboard-focused edge and removes a focused point',()=>{
  setup('object');
  const edge=screen.getByRole('button',{name:'Add point on object edge 1'});
  edge.focus();fireEvent.keyDown(edge,{key:'Enter'});
  expect(useTrackingEditorStore.getState().contourDraft).toHaveLength(5);
  expect(useTrackingEditorStore.getState().contourDraft![1]).toEqual({x:.5,y:.2});
  fireEvent.keyDown(screen.getByRole('slider',{name:'Object point 1'}),{key:'Delete'});
  expect(useTrackingEditorStore.getState().contourDraft).toHaveLength(3);
});

it('accepts new refinement clicks after tracking without reopening a selection tool',()=>{
  const svg=setup('inspect');
  fireEvent(svg,new MouseEvent('pointerdown',{bubbles:true,clientX:30,clientY:40}));
  expect(useTrackingEditorStore.getState().objectPrompts).toEqual([{x:.3,y:.4,label:1}]);
  expect(useTrackingEditorStore.getState().tool).toBe('pick-object');
});
