import type { CompositionTimelineData, SerializableClip, TimelineTrack } from '../../types/timeline';
import type { TerrainPlacement } from '../../types/terrainTracking';
import type { MotionLayerDefinition } from '../../types/motionDesign';
import type { Keyframe } from '../../types/keyframes';
import { createDefaultMotionLayerDefinition } from '../../types/motionDesign';
import { DEFAULT_TEXT_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';

export const FOOTPRINT_SIZE = { width: 512, height: 1024 };
export const FOOTPRINT_COLORS = { analysing: '#14b8ff', rejected: '#ff2929', locked: '#14ff38' } as const;
export type NativeFootprintPhase = keyof typeof FOOTPRINT_COLORS;
const makeId = () => crypto.randomUUID();
const cyan = { r: .05, g: .88, b: 1, a: 1 };
const green = { r: .08, g: 1, b: .22, a: 1 };
const fallback: [number, number][] = [[.25,.04],[.65,.025],[.84,.10],[.94,.25],[.88,.48],[.79,.68],[.80,.88],[.67,.97],[.30,.96],[.17,.86],[.20,.64],[.10,.40],[.12,.17]];

function track(name: string): TimelineTrack {
  return { id: makeId(), name, type: 'video', height: 60, muted: false, visible: true, solo: false };
}

function timeline(tracks: TimelineTrack[], clips: SerializableClip[], duration: number): CompositionTimelineData {
  return { tracks, clips, playheadPosition: 0, duration, durationLocked: true, zoom: 120, scrollX: 0,
    inPoint: null, outPoint: null, loopPlayback: false };
}

function clip(name: string, trackId: string, duration: number): SerializableClip {
  return { id: makeId(), name, trackId, startTime: 0, duration, inPoint: 0, outPoint: duration,
    mediaFileId: '', sourceType: 'motion-shape', naturalDuration: duration,
    transform: structuredClone(DEFAULT_TRANSFORM), effects: [] };
}

function path(points: [number, number][], fill: number, stroke = 0): MotionLayerDefinition {
  const motion = createDefaultMotionLayerDefinition('shape', { primitive: 'path', size: { w: 512, h: 1024 } });
  motion.shape!.path = { closed: true, vertices: points.map(([x,y]) => ({ x, y, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } })) };
  motion.appearance!.items = [{ id: makeId(), name: 'Fill', kind: 'color-fill', visible: true, opacity: fill, color: { ...cyan } }];
  if (stroke) motion.appearance!.items.push({ id: makeId(), name: 'Outline', kind: 'stroke', visible: true, opacity: 1, color: { ...cyan }, width: stroke, alignment: 'center' });
  return motion;
}

function key(clipId: string, property: Keyframe['property'], time: number, value: number): Keyframe {
  return { id: makeId(), clipId, property, time, value, easing: 'linear' };
}

function colorKeys(item: SerializableClip, lock: number): void {
  item.keyframes ??= [];
  for (const appearance of item.motion?.appearance?.items ?? []) {
    if (appearance.kind !== 'color-fill' && appearance.kind !== 'stroke') continue;
    for (const channel of ['r','g','b'] as const) {
      const property = `appearance.${appearance.id}.color.${channel}` as Keyframe['property'];
      item.keyframes.push(key(item.id, property, 0, cyan[channel]), key(item.id, property, Math.max(0,lock-.06), cyan[channel]), key(item.id, property, lock, green[channel]));
    }
  }
}

/** Ordinary Motion paths, Grid Replicators and scan bars; no footprint render primitive. */
export function nativeSoleTimeline(duration: number, lock: number): CompositionTimelineData {
  const scanTrack = track('Scan bars · position / opacity keys');
  const rightTrack = track('Right tread · Grid Replicator');
  const leftTrack = track('Left tread · Grid Replicator');
  const clips: SerializableClip[] = [];
  for (const [side, lane] of [[-1,leftTrack],[1,rightTrack]] as const) {
    const item = clip(`${side < 0 ? 'Left' : 'Right'} chevron stolls`, lane.id, duration);
    const inner = 20, outer = 275;
    item.motion = path([[side*inner, 35],[side*outer, -101],[side*outer,-157],[side*inner,-21]], .78);
    item.motion.shape!.size = { w: 560, h: 320 };
    item.motion.replicator!.enabled = true;
    item.motion.replicator!.layout = { mode: 'grid', count: { columns: 1, rows: 11 }, spacing: { x: 0, y: 114 }, patternOffset: { x: 0, y: 0 } };
    colorKeys(item, lock);
    clips.push(item);
  }
  // Repeated clips keep each scan editable using standard timing and keyframes.
  for (let start = 0; start < lock - .12; start += .48) {
    const length = Math.min(.44, lock-start);
    const item = clip('Scan sweep', scanTrack.id, length);
    item.startTime = start;
    item.motion = path([[-280,-12],[280,-12],[280,12],[-280,12]], .8);
    item.motion.shape!.size = { w: 560, h: 24 };
    item.keyframes = [key(item.id,'position.y',0,-490/512),key(item.id,'position.y',length,490/512),
      key(item.id,'opacity',0,0),key(item.id,'opacity',Math.min(.06,length/3),.9),key(item.id,'opacity',length,0)];
    clips.push(item);
  }
  return timeline([scanTrack,rightTrack,leftTrack],clips,duration);
}

/** Compose editable text, outline, and a normally masked nested sole composition. */
export function nativeFootprintTimeline(placement: TerrainPlacement, soleCompositionId: string, duration: number, lock: number): CompositionTimelineData {
  const contour = placement.contour?.length && placement.contour.length >= 3 ? placement.contour : fallback;
  const outlineTrack = track('Foot contour · editable path');
  const textTrack = track('L / R · editable text');
  const soleTrack = track('Sole and scan · editable masked comp');
  const outline = clip('Traced foot contour',outlineTrack.id,duration);
  outline.motion = path(contour.map(([x,y]) => [(x-.5)*512,(y-.5)*1024]), .09, 4);
  colorKeys(outline,lock);
  const sole = clip('Sole profile and scan',soleTrack.id,duration);
  sole.sourceType = 'video'; sole.isComposition = true; sole.compositionId = soleCompositionId;
  sole.masks = [{ id: makeId(), name: 'Foot silhouette', vertices: contour.map(([x,y]) => ({id:makeId(),x,y,handleIn:{x:0,y:0},handleOut:{x:0,y:0}})),
    closed:true, opacity:1, feather:.5, featherQuality:1, inverted:false, mode:'add', expanded:true, position:{x:0,y:0}, enabled:true, visible:true }];
  sole.masks.push({ id: makeId(), name: 'Heel flex groove', vertices: [[0,.712],[1,.712],[1,.748],[0,.748]].map(([x,y])=>({id:makeId(),x,y,handleIn:{x:0,y:0},handleOut:{x:0,y:0}})),
    closed:true, opacity:1, feather:.5, featherQuality:1, inverted:false, mode:'subtract', expanded:false, position:{x:0,y:0}, enabled:true, visible:true });
  const labels = [false,true].map(locked => {
    const item = clip(locked ? 'Locked L / R' : 'Analysing L / R',textTrack.id,locked ? duration-lock : lock);
    item.startTime = locked ? lock : 0;
    item.sourceType = 'text';
    item.textProperties = { ...DEFAULT_TEXT_PROPERTIES, text: placement.side === 'left' ? 'L' : 'R',
      fontFamily:'Arial Black', fontSize:130, color:locked?'#14ff38':'#14e8ff', strokeEnabled:true,strokeColor:'#08282a',strokeWidth:7,
      boxEnabled:true,boxX:(placement.labelX??.5)*512-100,boxY:(placement.labelY??.415)*1024-85,boxWidth:200,boxHeight:170,
      textAlign:'center',verticalAlign:'middle',wrapMode:'none' };
    return item;
  });
  return timeline([textTrack,outlineTrack,soleTrack],[...labels,outline,sole],duration);
}

/** Reusable native artwork: phase timing belongs to its ordinary parent clips. */
export function nativeFootprintVariant(placement: TerrainPlacement, soleCompositionId: string, duration: number, phase: NativeFootprintPhase): CompositionTimelineData {
  const data = nativeFootprintTimeline(placement, soleCompositionId, duration, 0);
  data.clips = data.clips.filter(item => item.duration > 0);
  recolorNativeFootprint(data, phase);
  return data;
}

export function nativeSoleVariant(duration: number, phase: NativeFootprintPhase): CompositionTimelineData {
  const data = nativeSoleTimeline(duration, phase === 'analysing' ? Math.min(2, duration) : 0);
  recolorNativeFootprint(data, phase);
  return data;
}

function recolorNativeFootprint(data: CompositionTimelineData, phase: NativeFootprintPhase): void {
  const hex = FOOTPRINT_COLORS[phase];
  const color = { r: parseInt(hex.slice(1,3),16)/255, g: parseInt(hex.slice(3,5),16)/255, b: parseInt(hex.slice(5,7),16)/255, a: 1 };
  for (const item of data.clips) {
    item.keyframes = item.keyframes?.filter(key => !key.property.startsWith('appearance.')) ?? [];
    if (item.textProperties) item.textProperties.color = hex;
    for (const appearance of item.motion?.appearance?.items ?? []) {
      if (appearance.kind === 'color-fill' || appearance.kind === 'stroke') appearance.color = { ...color };
    }
  }
}
