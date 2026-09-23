import { expect, it } from 'vitest';
import { adaptiveTemporalPreview } from '../../src/effects/time/adaptiveTemporalPreview';
import type { SourceTemporalRequest } from '../../src/effects/time/SourceTemporalRuntime';

const request = { media: { width:1920,height:1080,fps:30 }, source: {
  speed:1,speedKeyframes:[],inPoint:0,outPoint:120,localTime:10,
}, samples:1920,nearest:false,horizon:4 } as SourceTemporalRequest;

it('reduces interactive resolution even with enough VRAM for original frames, without reducing temporal samples', () => {
  const plan = adaptiveTemporalPreview(request,4096);
  expect(plan.maxEdge).toBe(960);
  expect(request.samples).toBe(1920);
  expect(adaptiveTemporalPreview({...request,source:{...request.source,localTime:60}},4096)).toEqual(plan);
});

it('further reduces long windows to fit memory and never upscales small media', () => {
  const long = adaptiveTemporalPreview({...request,horizon:100},640);
  expect(long.maxEdge).toBeLessThan(960);
  const edge = long.maxEdge!;
  const bytes = edge*(edge*1080/1920)*4*(long.reserveFrames+2);
  expect(bytes).toBeLessThanOrEqual(long.budgetMiB*1024*1024*.85);
  expect(adaptiveTemporalPreview({...request,media:{...request.media,width:320,height:180}},4096).maxEdge).toBeUndefined();
});
