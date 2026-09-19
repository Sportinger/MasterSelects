import { describe, expect, it } from 'vitest';
import { nativeFootprintTimeline, nativeSoleTimeline } from '../../src/services/planarTracking/nativeFootprintDesign';
import { splitPathSegment } from '../../src/services/motionDesign/path/splitPathSegment';

describe('native footprint authoring', () => {
  it('preserves the supplied contact outline in the native path and ordinary clipping mask', () => {
    const contour: [number,number][] = [[.1,.1],[.9,.1],[.8,.95],[.15,.9]];
    const original=structuredClone(contour);
    const data=nativeFootprintTimeline({ x:0,y:0,width:1,height:2,rotation:0,contour,side:'right' },'sole',3.4,1.5);
    const outline=data.clips.find(clip=>clip.motion)!;
    outline.motion!.shape!.path!.vertices.forEach((p,i) => {
      expect(p.x/512+.5).toBeCloseTo(contour[i][0],12);
      expect(p.y/1024+.5).toBeCloseTo(contour[i][1],12);
    });
    expect(data.clips.find(clip=>clip.compositionId==='sole')!.masks![0].vertices.map(p=>[p.x,p.y])).toEqual(contour);
    expect(contour).toEqual(original);
    expect(data.clips.filter(clip=>clip.sourceType==='text').map(clip=>clip.textProperties!.text)).toEqual(['R','R']);
  });
  it('uses native replicators and only schedules independent scan clips before lock', () => {
    const data=nativeSoleTimeline(3.4,1.5);
    expect(data.clips.filter(clip=>clip.motion?.replicator?.enabled)).toHaveLength(2);
    const scans=data.clips.filter(clip=>clip.name==='Scan sweep');
    expect(scans.length).toBeGreaterThan(1);
    expect(scans.every(clip=>clip.startTime+clip.duration<=1.5+1e-8)).toBe(true);
  });
  it('inserts a midpoint while preserving cubic handles and the original input', () => {
    const vertices=[{x:0,y:0,handleIn:{x:0,y:0},handleOut:{x:0,y:100}},
      {x:100,y:0,handleIn:{x:0,y:100},handleOut:{x:0,y:0}}];
    const before=structuredClone(vertices);
    const result=splitPathSegment({vertices,closed:false},0);
    expect(result[1]).toMatchObject({x:50,y:75,handleIn:{x:-25,y:0},handleOut:{x:25,y:0}});
    expect(result[0].handleOut).toEqual({x:0,y:50});
    expect(result[2].handleIn).toEqual({x:0,y:50});
    expect(vertices).toEqual(before);
  });
});
