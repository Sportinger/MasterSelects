import { useMediaStore, type Composition } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { addCompositionSegment, addMediaSegment } from './clipSegments';
import { addEffect, addNumericKeyframes, addPolygonMask, updateClipVisuals } from './clipVisuals';
import { getVideoTracks, openComposition, saveActiveTimelineToComposition } from './compositionRuntime';
import type { FixtureBuildContext } from './model';

export async function buildSubComposition(ctx: FixtureBuildContext): Promise<Composition> {
  const mediaStore = useMediaStore.getState();
  const comp = mediaStore.createComposition('Stress test 02 - Detail Subcomp', {
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    duration: ctx.durationSeconds,
  });
  await openComposition(comp.id);

  const timelineStore = useTimelineStore.getState();
  timelineStore.addTrack('video');
  const tracks = getVideoTracks();

  const detailClip = await addMediaSegment({
    media: ctx.detail,
    trackId: tracks.base,
    startTime: 0,
    inPoint: 0.6,
    outPoint: Math.min(6.6, ctx.detail.duration ?? 6.6),
    name: 'sub detail base',
  });
  addEffect(detailClip.id, 'gaussian-blur', { radius: 3 });
  addEffect(detailClip.id, 'contrast', { amount: 1.28 });

  const blendClip = await addMediaSegment({
    media: ctx.blend,
    trackId: tracks.top,
    startTime: 0.65,
    inPoint: 1.0,
    outPoint: Math.min(6.2, ctx.blend.duration ?? 6.2),
    name: 'sub blend masked overlay',
  });
  updateClipVisuals(blendClip.id, {
    transform: {
      ...blendClip.transform,
      opacity: 0.72,
      blendMode: 'screen',
      position: { x: 0.16, y: -0.08, z: 0 },
      scale: { x: 0.7, y: 0.7 },
    },
  });
  addPolygonMask(blendClip.id, 'sub diamond mask', [
    { x: 0.5, y: 0.06 },
    { x: 0.9, y: 0.46 },
    { x: 0.54, y: 0.94 },
    { x: 0.12, y: 0.52 },
  ], { feather: 24, featherQuality: 75 });
  addNumericKeyframes(blendClip.id, 'position.x', [
    { time: 0, value: 0.08 },
    { time: 2.3, value: 0.2 },
    { time: 5.2, value: -0.04 },
  ]);

  timelineStore.setPlayheadPosition(0.25);
  saveActiveTimelineToComposition(comp.id, ctx.durationSeconds);
  return useMediaStore.getState().compositions.find((entry) => entry.id === comp.id) ?? comp;
}

export async function buildNestedComposition(ctx: FixtureBuildContext, subComp: Composition): Promise<Composition> {
  const mediaStore = useMediaStore.getState();
  const comp = mediaStore.createComposition('Stress test 01 - Nested Blend', {
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    duration: ctx.durationSeconds,
  });
  await openComposition(comp.id);

  const timelineStore = useTimelineStore.getState();
  timelineStore.addTrack('video');
  const tracks = getVideoTracks();

  const baseClip = await addMediaSegment({
    media: ctx.blend,
    trackId: tracks.base,
    startTime: 0,
    inPoint: 0.2,
    outPoint: Math.min(6.2, ctx.blend.duration ?? 6.2),
    name: 'nested blend base',
  });
  addEffect(baseClip.id, 'saturation', { amount: 1.35 });
  addEffect(baseClip.id, 'brightness', { amount: -0.04 });

  const subClip = await addCompositionSegment({
    composition: subComp,
    trackId: tracks.middle,
    startTime: 0.35,
    name: 'nested detail subcomp layer',
  });
  updateClipVisuals(subClip.id, {
    transform: {
      ...subClip.transform,
      opacity: 0.82,
      blendMode: 'overlay',
      position: { x: -0.14, y: 0.08, z: 0 },
      scale: { x: 0.78, y: 0.78 },
    },
  });
  const subMaskId = useTimelineStore.getState().addEllipseMask(subClip.id);
  useTimelineStore.getState().updateMask(subClip.id, subMaskId, {
    name: 'nested soft ellipse',
    feather: 28,
    featherQuality: 80,
    opacity: 0.95,
    position: { x: 0.05, y: -0.02 },
  });

  const detailClip = await addMediaSegment({
    media: ctx.detail,
    trackId: tracks.top,
    startTime: 1.1,
    inPoint: 1.5,
    outPoint: Math.min(5.8, ctx.detail.duration ?? 5.8),
    name: 'nested masked detail strip',
  });
  updateClipVisuals(detailClip.id, {
    transform: {
      ...detailClip.transform,
      opacity: 0.58,
      blendMode: 'add',
      position: { x: 0.22, y: 0.18, z: 0 },
      scale: { x: 0.52, y: 0.52 },
    },
  });
  addPolygonMask(detailClip.id, 'nested angled strip mask', [
    { x: 0.05, y: 0.2 },
    { x: 0.88, y: 0.05 },
    { x: 0.96, y: 0.38 },
    { x: 0.18, y: 0.58 },
  ], { feather: 16, featherQuality: 65 });

  timelineStore.setPlayheadPosition(0.5);
  saveActiveTimelineToComposition(comp.id, ctx.durationSeconds);
  return useMediaStore.getState().compositions.find((entry) => entry.id === comp.id) ?? comp;
}
