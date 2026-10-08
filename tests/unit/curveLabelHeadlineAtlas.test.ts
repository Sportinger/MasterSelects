import {afterEach,expect,it,vi} from 'vitest';
import {curveLabelDecodeFrames} from '../../src/engine/native3d/labels/curveLabelDecode';
import {CurveLabelHeadlineCache} from '../../src/engine/native3d/labels/CurveLabelHeadlineAtlas';
afterEach(()=>vi.unstubAllGlobals());
it('keeps shaped phrases whole and retires replaced atlases after command submission',()=>{
 const fillText=vi.fn(),resources:Array<{destroy:ReturnType<typeof vi.fn>}>=[];
 vi.stubGlobal('OffscreenCanvas',class {getContext(){return {fillText,measureText:(word:string)=>({width:word.length*40,actualBoundingBoxLeft:0,actualBoundingBoxRight:word.length*40,actualBoundingBoxAscent:64,actualBoundingBoxDescent:10})};}});
 vi.stubGlobal('GPUTextureUsage',{TEXTURE_BINDING:1,COPY_DST:2,RENDER_ATTACHMENT:4});
 vi.stubGlobal('GPUBufferUsage',{STORAGE:1,COPY_DST:2});
 const create=()=>{const resource={destroy:vi.fn()};resources.push(resource);return resource;};
 const device={createTexture:create,createBuffer:create,createSampler:()=>({}),queue:{copyExternalImageToTexture:vi.fn(),writeBuffer:vi.fn()}} as unknown as GPUDevice;
 const cache=new CurveLabelHeadlineCache(),first=cache.get(device,['कला','KANN WEG.']);
 expect(fillText.mock.calls.map(c=>c[0])).toEqual(['कला','KANN WEG.'].flatMap(curveLabelDecodeFrames));
 expect(first.height).toBeLessThan(2048);
 expect(cache.get(device,['कला','KANN WEG.'])).toBe(first);
 for(let i=0;i<8;i++)cache.get(device,[`TITLE ${i}`]);
 expect(resources[0].destroy).not.toHaveBeenCalled();expect(resources[1].destroy).not.toHaveBeenCalled();
 cache.afterSubmit();expect(resources[0].destroy).toHaveBeenCalledOnce();expect(resources[1].destroy).toHaveBeenCalledOnce();
 cache.dispose();for(const resource of resources)expect(resource.destroy).toHaveBeenCalledOnce();
});

it('decodes complete graphemes deterministically, settling punctuation last',()=>{
 const frames=curveLabelDecodeFrames('KUNST?');
 expect(frames.at(-1)).toBe('KUNST?');expect(frames[0]).not.toBe('KUNST?');
 expect(frames).toEqual(curveLabelDecodeFrames('KUNST?'));
 expect(frames[4].startsWith('KUN')).toBe(true);expect(frames[4].endsWith('?')).toBe(false);
 const hindi=curveLabelDecodeFrames('कला');
 expect(hindi.at(-1)).toBe('कला');
 // The vowel sign belongs to ला: it never appears without its base consonant.
 expect(hindi.every(frame=>!frame.includes('ा')||frame.endsWith('ला'))).toBe(true);
 expect(curveLabelDecodeFrames('A B').every(frame=>frame[1]===' ')).toBe(true);
});
