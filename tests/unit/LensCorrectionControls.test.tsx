import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LensCorrectionControls } from '../../src/components/panels/properties/LensCorrectionControls';

const store=vi.hoisted(()=>({clips:[] as Array<{id:string;file?:File}>}));
const raw=vi.hoisted(()=>({read:new Map<File,Promise<unknown>>()}));
vi.mock('../../src/stores/timeline',()=>({useTimelineStore:Object.assign((select:(state:typeof store)=>unknown)=>select(store),
  {getState:()=>({...store,isRecording:()=>false,hasKeyframes:()=>false,getClipKeyframes:()=>[]})})}));
vi.mock('../../src/services/rawImage/rawImageDecode',()=>({isRawImageFile:(file:File)=>raw.read.has(file),
  getRawPhotoMetadata:(file:File)=>raw.read.get(file)}));
describe('Lens Correction vignette bypass',()=>{
  it('uses the shared section switch and preserves adjustments when bypassed and restored',()=>{
    const changed=vi.fn();
    function Controls() {
      const [params,setParams]=useState<Record<string,number|boolean|string>>({profile:'manual',vignette:35,distortion:12});
      return <LensCorrectionControls params={params} onChange={next=>{changed(next);setParams(next);}}/>;
    }
    render(<Controls/>);
    const toggle=screen.getByRole('switch',{name:'Disable Vignette'});
    expect(toggle).toHaveAttribute('aria-checked','true');
    toggle.focus(); fireEvent.pointerUp(toggle); fireEvent.click(toggle);
    expect(toggle).not.toHaveFocus();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({vignetteEnabled:false,vignette:35,distortion:12}));
    const enable=screen.getByRole('switch',{name:'Enable Vignette'});
    enable.focus(); expect(enable).toHaveFocus(); fireEvent.click(enable);
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({vignetteEnabled:true,vignette:35,distortion:12}));
    fireEvent.click(screen.getByRole('combobox',{name:'Lens correction framing'}));
    fireEvent.click(screen.getByRole('option',{name:'Fit entire photo'}));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({fitFullImage:true,vignette:35,distortion:12}));
    expect(screen.queryByRole('slider',{name:'Scale',exact:true})).not.toBeInTheDocument();
  });
});

describe('Lens Correction card',()=>{
  it('shows camera metadata only for the file it was read from', async ()=>{
    const a=new File(['a'],'a.cr2'), b=new File(['b'],'b.cr2');
    raw.read.set(a,Promise.resolve({lens:'EF24-105mm f/4L IS USM',focalLength:32,aperture:8,width:6000,height:4000}));
    raw.read.set(b,new Promise(()=>{}));
    store.clips=[{id:'clip',file:a}];
    const view=render(<LensCorrectionControls params={{profile:'manual'}} onChange={()=>{}} clipId="clip" effectInstanceId="lens"/>);
    expect(await screen.findByText(/EF24-105mm f\/4L IS USM · 32 mm · f\/8/)).toBeInTheDocument();
    store.clips=[{id:'clip',file:b}];
    await act(async()=>{ view.rerender(<LensCorrectionControls params={{profile:'manual'}} onChange={()=>{}} clipId="clip" effectInstanceId="lens"/>); });
    expect(screen.queryByText(/EF24-105mm/)).not.toBeInTheDocument();
    store.clips=[]; raw.read.clear();
  });
  it('drops pointer focus from its menus but keeps keyboard focus', ()=>{
    render(<LensCorrectionControls params={{profile:'manual'}} onChange={()=>{}}/>);
    const lens=screen.getByRole('combobox',{name:'Lens profile'});
    lens.focus(); expect(lens).toHaveFocus();
    fireEvent.keyDown(lens,{key:'Tab'}); expect(lens).toHaveFocus();
    fireEvent.pointerUp(lens); expect(lens).not.toHaveFocus();
  });
});
