import type { Composition } from '../../stores/mediaStore/types';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { MotionLayerDefinition } from '../../types/motionDesign';
import type { CompositionTimelineData, SerializableClip, TimelineClip, TimelineTrack } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { PlanarTrack } from '../../types/planarTracking';
import type { TerrainFootstep } from '../../types/terrainTracking';
import { createDefaultMotionLayerDefinition } from '../../types/motionDesign';
import { renderHostPort } from '../render/renderHostPort';
import { layerBuilder } from '../layerBuilder';
import { surfaceSourceTime } from './surfaceEffects';
import { clonePlanarTracks } from './clonePlanarTracks';
import { FOOTPRINT_SIZE, nativeFootprintTimeline, nativeSoleTimeline } from './nativeFootprintDesign';

const DURATION = 3.4;

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function cardTracks(): TimelineTrack[] {
  return [
    { id: id('terrain-card-title-track'), name: 'Card title (editable)', type: 'video', height: 60, muted: false, visible: true, solo: false },
    { id: id('terrain-card-detail-track'), name: 'Card detail (editable)', type: 'video', height: 60, muted: false, visible: true, solo: false },
    { id: id('terrain-card-frame-track'), name: 'Card frame (editable)', type: 'video', height: 60, muted: false, visible: true, solo: false },
  ];
}

function neonAppearance(motion: MotionLayerDefinition, fillAlpha: number, strokeWidth: number): MotionLayerDefinition {
  const appearance = motion.appearance;
  if (!appearance) return motion;
  appearance.items = [
    { id: id('foot-fill'), kind: 'color-fill', name: 'Cyan fill', visible: true, opacity: 1, color: { r: 0.05, g: 0.88, b: 1, a: fillAlpha } },
    { id: id('foot-stroke'), kind: 'stroke', name: 'Cyan contour', visible: true, opacity: 1, color: { r: 0.05, g: 0.88, b: 1, a: 1 }, width: strokeWidth, alignment: 'center' },
  ];
  appearance.selectedItemId = appearance.items[1].id;
  return motion;
}

function motionClip(name: string, trackId: string, motion: MotionLayerDefinition): SerializableClip {
  return {
    id: id('terrain-editable'), trackId, name, mediaFileId: '', startTime: 0, duration: DURATION, inPoint: 0, outPoint: DURATION,
    sourceType: 'motion-shape', naturalDuration: DURATION, transform: structuredClone(DEFAULT_TRANSFORM), effects: [], motion,
  };
}

function cardTextClip(name: string, trackId: string, text: string, width: number, height: number, y: number, size: number): SerializableClip {
  return {
    id: id('terrain-card-text'), trackId, name, mediaFileId: '', startTime: 0, duration: DURATION, inPoint: 0, outPoint: DURATION,
    sourceType: 'text', naturalDuration: DURATION, transform: structuredClone(DEFAULT_TRANSFORM), effects: [],
    textProperties: {
      ...DEFAULT_TEXT_PROPERTIES, text, fontFamily: 'Arial Black', fontSize: size, color: '#14e8ff', strokeEnabled: true, strokeColor: '#06262d', strokeWidth: 5,
      boxX: Math.round(width * .5 - 290), boxY: Math.round(height * .5 + y), boxWidth: 580, boxHeight: 90, wrapMode: 'none', textAlign: 'center', verticalAlign: 'middle',
    },
  };
}

function cardFrame(): MotionLayerDefinition {
  const motion = neonAppearance(createDefaultMotionLayerDefinition('shape', { primitive: 'rectangle', size: { w: 650, h: 265 } }), .56, 9);
  if (motion.appearance?.items[0]?.kind === 'color-fill') motion.appearance.items[0].color = { r: .015, g: .06, b: .08, a: .82 };
  return motion;
}

function cardTimeline(side: 'left' | 'right', contactTime: number, width: number, height: number): CompositionTimelineData {
  const nestedTracks = cardTracks();
  return {
    tracks: nestedTracks,
    clips: [
      cardTextClip('Editable terrain card title', nestedTracks[0].id, `${side === 'left' ? 'L' : 'R'}  ·  TERRAIN LOCK`, width, height, -96, 43),
      cardTextClip('Editable terrain card detail', nestedTracks[1].id, `CONTACT  ${contactTime.toFixed(2)} s`, width, height, 5, 30),
      motionClip('Editable terrain card frame', nestedTracks[2].id, cardFrame()),
    ],
    playheadPosition: 0, duration: DURATION, durationLocked: true, zoom: 80, scrollX: 0, inPoint: null, outPoint: null, loopPlayback: false,
  };
}

function connectorMotion(): MotionLayerDefinition {
  return neonAppearance(createDefaultMotionLayerDefinition('shape', { primitive: 'rectangle', size: { w: 24, h: 24 } }), 0, 5);
}

function resolvedLockTime(steps: readonly TerrainFootstep[], selected: TerrainFootstep, sourceStart: number): number {
  const contact = selected.placement.contactTime ?? sourceStart;
  if (Number.isFinite(selected.placement.lockTime)) return selected.placement.lockTime!;
  const index = steps.findIndex(step => step.id === selected.id);
  const previous = steps[index - 1]?.placement.contactTime ?? sourceStart;
  const secondPrevious = steps[index - 2]?.placement.contactTime ?? sourceStart;
  const normalStart = Math.max(sourceStart, secondPrevious, contact - 2.4);
  const automaticLock = Math.max(normalStart + Math.min(1.3, (contact - normalStart) * .65) - .5, previous - .3, normalStart + .2);
  return Math.min(contact - .02, Math.max(normalStart + .01, automaticLock));
}

function clipLocalTimeForSourceTime(target: TimelineClip, sourceTime: number, keyframes: readonly Keyframe[]): number {
  const startSource = surfaceSourceTime(target, 0, keyframes);
  const endSource = surfaceSourceTime(target, target.duration, keyframes);
  const ascending = endSource >= startSource;
  let low = 0, high = target.duration;
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const local = (low + high) / 2;
    const currentSource = surfaceSourceTime(target, local, keyframes);
    if (ascending ? currentSource < sourceTime : currentSource > sourceTime) low = local;
    else high = local;
  }
  return (low + high) / 2;
}

function fadeAt(clipId: string, at: number): Keyframe[] {
  return [
    { id: id('terrain-key'), clipId, property: 'opacity', time: 0, value: 1, easing: 'linear' },
    { id: id('terrain-key'), clipId, property: 'opacity', time: Math.max(.001, at - .08), value: 1, easing: 'linear' },
    { id: id('terrain-key'), clipId, property: 'opacity', time: at, value: 0, easing: 'linear' },
  ];
}

export async function createEditableTerrainFootstepPrototype(input: {
  targetVideoClipId: string;
  track: PlanarTrack;
  step: TerrainFootstep;
}): Promise<{ composition: Composition; componentClipId: string }> {
  const media = useMediaStore.getState();
  const timeline = useTimelineStore.getState();
  const target = timeline.clips.find(clip => clip.id === input.targetVideoClipId);
  const surface = target?.planarTracks?.find(track => track.id === input.track.id);
  const terrain = surface?.terrain;
  const contactTime = input.step.placement.contactTime;
  if (!target || !surface || !terrain?.denseMesh || typeof contactTime !== 'number' || !Number.isFinite(contactTime)) {
    throw new Error('Select a solved terrain contact on the original video before creating an editable footprint.');
  }
  const sourceComposition = media.getActiveComposition();
  if (!sourceComposition?.timelineData) {
    throw new Error('The active composition has no timeline data to use as a prototype source.');
  }
  const sourceKeys = timeline.getClipKeyframes(target.id);
  const contactTimelineTime = target.startTime + clipLocalTimeForSourceTime(target, contactTime, sourceKeys);
  const componentStart = Math.max(0, contactTimelineTime - DURATION + .25);
  const lockTime = resolvedLockTime(terrain.footsteps ?? [], input.step, terrain.cameras[0]?.time ?? 0);
  const lockTimelineTime = target.startTime + clipLocalTimeForSourceTime(target, lockTime, sourceKeys);
  const lockLocal = Math.max(.1, Math.min(DURATION - .1, lockTimelineTime - componentStart));
  const soleComposition = media.createComposition(`EDITABLE Sole and scan ? ${input.step.name}`, {
    parentId: null, ...FOOTPRINT_SIZE, frameRate: sourceComposition.frameRate, duration: DURATION,
    backgroundColor: '#00000000', timelineData: nativeSoleTimeline(DURATION, lockLocal),
  });
  const footprintComposition = media.createComposition(`EDITABLE ${input.step.placement.side === 'left' ? 'L' : 'R'} Footstep · ${input.step.name}`, {
    parentId: null,
    ...FOOTPRINT_SIZE,
    frameRate: sourceComposition.frameRate, duration: DURATION, backgroundColor: '#00000000',
    timelineData: nativeFootprintTimeline(input.step.placement, soleComposition.id, DURATION, lockLocal),
  });
  const cardComposition = media.createComposition(`EDITABLE Terrain Card · ${input.step.name}`, {
    parentId: null,
    width: media.getActiveComposition()?.width ?? 1920,
    height: media.getActiveComposition()?.height ?? 1080,
    frameRate: media.getActiveComposition()?.frameRate ?? 30,
    duration: DURATION,
    backgroundColor: '#00000000',
    timelineData: cardTimeline(
      input.step.placement.side ?? 'left', contactTime,
      media.getActiveComposition()?.width ?? 1920, media.getActiveComposition()?.height ?? 1080,
    ),
  });
  // The mesh is immutable and shared by identity across the source and its
  // prototype. A blanket structuredClone would duplicate tens of megabytes
  // of terrain arrays for a single editable component.
  const prototypeTimeline: CompositionTimelineData = {
    ...sourceComposition.timelineData,
    tracks: sourceComposition.timelineData.tracks.map(track => ({ ...track })),
    clips: sourceComposition.timelineData.clips.map(clip => {
      const { planarTracks, ...serializable } = clip;
      return { ...structuredClone(serializable), planarTracks: clonePlanarTracks(planarTracks) };
    }),
  };
  const footprintTrack: TimelineTrack = { id: id('terrain-prototype-track'), name: 'Editable terrain footprint', type: 'video', height: 60, muted: false, visible: true, solo: false };
  const connectorTrack: TimelineTrack = { id: id('terrain-connector-track'), name: 'Terrain card connector', type: 'video', height: 60, muted: false, visible: true, solo: false };
  const cardTrack: TimelineTrack = { id: id('terrain-card-track'), name: 'Editable terrain card', type: 'video', height: 60, muted: false, visible: true, solo: false };
  const lockTrack: TimelineTrack = { id: id('terrain-lock-audio-track'), name: 'Terrain lock cue (editable)', type: 'audio', height: 60, muted: false, visible: true, solo: false };
  const componentClipId = id('terrain-component');
  const cardClipId = id('terrain-card');
  const connectorClipId = id('terrain-connector');
  const attachment = { version: 1 as const, targetVideoClipId: target.id, trackId: surface.id, footstepId: input.step.id, placement: structuredClone(input.step.placement), visible: true };
  prototypeTimeline.tracks = [cardTrack, connectorTrack, footprintTrack, ...prototypeTimeline.tracks, lockTrack];
  prototypeTimeline.clips = prototypeTimeline.clips.map(clip => clip.id !== target.id ? clip : {
    ...clip,
    planarTracks: clip.planarTracks?.map(track => track.id !== surface.id ? track : { ...track, enabled: false, footstepPresentation: undefined }),
  });
  prototypeTimeline.clips.push({
    id: componentClipId, trackId: footprintTrack.id, name: footprintComposition.name, mediaFileId: '',
    startTime: componentStart, duration: DURATION, inPoint: 0, outPoint: DURATION,
    sourceType: 'video', naturalDuration: DURATION, transform: structuredClone(DEFAULT_TRANSFORM), effects: [],
    isComposition: true, compositionId: footprintComposition.id,
    terrainAttachment: attachment,
  });
  prototypeTimeline.clips.push({
    id: connectorClipId, trackId: connectorTrack.id, name: 'Terrain card connector (editable stroke)', mediaFileId: '',
    startTime: componentStart, duration: DURATION, inPoint: 0, outPoint: DURATION,
    sourceType: 'motion-shape', naturalDuration: DURATION, transform: structuredClone(DEFAULT_TRANSFORM), effects: [], motion: connectorMotion(),
    terrainAnchorConnector: { anchorClipId: cardClipId, color: '#14e8ff', width: 5, opacity: .92 },
    keyframes: fadeAt(connectorClipId, lockLocal),
  });
  prototypeTimeline.clips.push({
    id: cardClipId, trackId: cardTrack.id, name: cardComposition.name, mediaFileId: '',
    startTime: componentStart, duration: DURATION, inPoint: 0, outPoint: DURATION,
    sourceType: 'video', naturalDuration: DURATION, transform: structuredClone(DEFAULT_TRANSFORM), effects: [],
    isComposition: true, compositionId: cardComposition.id,
    terrainScreenAnchor: { attachment: structuredClone(attachment), offset: { x: .08, y: -.12 } },
    keyframes: fadeAt(cardClipId, lockLocal),
  });
  const lockSource = sourceComposition.timelineData.clips.find(clip => (
    clip.sourceType === 'audio' && /HUD - Lock v2\.wav/i.test(clip.name)
  ));
  if (lockSource) {
    const lockDuration = .45;
    const lockInPoint = Math.max(lockSource.inPoint, lockTimelineTime - lockSource.startTime - .12);
    prototypeTimeline.clips.push({
      ...structuredClone(lockSource),
      id: id('terrain-lock-cue'), trackId: lockTrack.id, name: 'Terrain lock cue · editable timing',
      startTime: Math.max(0, lockTimelineTime - .08), duration: lockDuration,
      inPoint: lockInPoint, outPoint: lockInPoint + lockDuration, naturalDuration: lockDuration,
    });
  }
  const composition = media.createComposition(`TERRAIN PROJECTION PROTOTYPE · ${input.step.name}`, {
    parentId: null,
    width: sourceComposition.width, height: sourceComposition.height, frameRate: sourceComposition.frameRate,
    duration: sourceComposition.duration, backgroundColor: sourceComposition.backgroundColor, timelineData: prototypeTimeline,
  });
  layerBuilder.invalidateCache();
  renderHostPort.requestRender();
  await media.openCompositionTab(composition.id, { skipAnimation: true });
  return { composition, componentClipId };
}
