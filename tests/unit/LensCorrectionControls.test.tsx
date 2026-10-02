import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LensCorrectionControls } from '../../src/components/panels/properties/LensCorrectionControls';

vi.mock('../../src/stores/timeline',()=>({useTimelineStore:(select:(state:{clips:[]})=>unknown)=>select({clips:[]})}));
vi.mock('../../src/services/rawImage/rawImageDecode',()=>({isRawImageFile:()=>false,getRawPhotoMetadata:vi.fn()}));
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
