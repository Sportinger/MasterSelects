import {describe,it,expect} from 'vitest';
import {strandPixelHit,strandIdColors,visibleStrandCandidates,type StrandIdFrame} from '../../src/engine/native3d/passes/strandIdMap';
import {getToolPolicy} from '../../src/services/aiTools/policy';
import {isKernelEditorToolName} from '../../src/services/aiTools/editorToolCatalog';
const frame=():StrandIdFrame=>({width:3,height:3,time:0,targetKey:'fixture',pixels:new Uint32Array(36),
  layers:[{clipId:'rope',layerId:'layer',starts:Uint32Array.of(0,5),counts:Uint32Array.of(5,11)}]});
describe('visible strand material coordinates',()=>{
 it('decodes exact variable-length material coordinates independently of PNG colors',()=>{
  const f=frame();f.pixels.set([8,0x3f000000,2,1],16);
  expect(strandPixelHit(f,1,1)).toMatchObject({strand:1,point:7,fraction:.5,u:.25,clipId:'rope'});
  const colors=strandIdColors(f);expect([...colors.slice(16,19)].some(v=>v>0)).toBe(true);
  expect([...colors.slice(0,4)]).toEqual([0,0,0,255]);
  expect(visibleStrandCandidates(f)).toEqual([{...strandPixelHit(f,1,1),visiblePixels:1}]);
 });
 it('does not invent coordinates for empty, out-of-range or malformed pixels',()=>{
  const f=frame();expect(strandPixelHit(f,0,0)).toBeNull();expect(strandPixelHit(f,3,1)).toBeNull();expect(strandPixelHit(f,1.1,1)).toBeNull();
  for(const bad of [[999,0,1,1],[1,0x7fc00000,1,1],[1,0,99,1],[1,0,1,9]]){
   f.pixels.set(bad,16);expect(strandPixelHit(f,1,1)).toBeNull();
  }
 });
 it('keeps the diagnostic read-only and out of provider/kernel discovery',()=>{
  const policy=getToolPolicy('captureStrandMap');expect(policy?.readOnly).toBe(true);
  expect(policy?.allowedCallers).not.toContain('chat');expect(isKernelEditorToolName('captureStrandMap')).toBe(false);
 });
});
