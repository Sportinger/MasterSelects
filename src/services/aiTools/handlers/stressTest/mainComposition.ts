import { renderHostPort } from '../../../render/renderHostPort';
import { useMediaStore, type Composition } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { addCompositionSegment, addMediaSegment } from './clipSegments';
import { addEffect, addNumericKeyframes, addPolygonMask, updateClipVisuals } from './clipVisuals';
import { getVideoTracks, openComposition, saveActiveTimelineToComposition } from './compositionRuntime';
import type { FixtureBuildContext } from './model';
import { waitForAnimationFrame } from './timing';

export async function buildMainComposition(
  ctx: FixtureBuildContext,
  mainComp: Composition,
  nestedComp: Composition
): Promise<Composition> {
  const mediaStore = useMediaStore.getState();
  mediaStore.updateComposition(mainComp.id, {
    name: 'Stress test 00 - Main Fast',
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    duration: ctx.durationSeconds,
  });
  await openComposition(mainComp.id);

  const timelineStore = useTimelineStore.getState();
  timelineStore.addTrack('video');
  const tracks = getVideoTracks();

  const baseA = await addMediaSegment({
    media: ctx.primary,
    trackId: tracks.base,
    startTime: 0,
    inPoint: 0.1,
    outPoint: Math.min(3.4, ctx.primary.duration ?? 3.4),
    name: 'main voxel primary A',
  });
  const voxelEffectA = addEffect(baseA.id, 'voxel-relief', {
    columns: 92,
    height: 0.62,
    baseHeight: 0.012,
    gap: 0.055,
    tilt: 86,
    yaw: 0,
    perspective: 0.46,
    heightContrast: 1.2,
    ambient: 0.54,
    lightStrength: 0.62,
    colorMix: 0.94,
    temporalBlend: 0.08,
    lightAngle: 315,
    lightElevation: 48,
    floorBrightness: 0.08,
    edgeDarkness: 0.72,
    maxSteps: 64,
    reset: false,
  });
  addNumericKeyframes(baseA.id, `effect.${voxelEffectA}.height`, [
    { time: 0, value: 0.36 },
    { time: 1.6, value: 0.78 },
    { time: 3.3, value: 0.52 },
  ]);

  const baseB = await addMediaSegment({
    media: ctx.detail,
    trackId: tracks.base,
    startTime: 3.4,
    inPoint: 2.1,
    outPoint: Math.min(5.8, ctx.detail.duration ?? 5.8),
    name: 'main voxel detail B',
  });
  addEffect(baseB.id, 'voxel-relief', {
    columns: 84,
    height: 0.5,
    baseHeight: 0.02,
    gap: 0.06,
    tilt: 85,
    yaw: -4,
    perspective: 0.38,
    heightContrast: 1.34,
    ambient: 0.5,
    lightStrength: 0.64,
    colorMix: 0.92,
    temporalBlend: 0.06,
    lightAngle: 300,
    lightElevation: 44,
    floorBrightness: 0.09,
    edgeDarkness: 0.7,
    maxSteps: 60,
    reset: false,
  });
  timelineStore.applyTransition(baseA.id, baseB.id, 'crossfade', 0.42);

  const nestedClip = await addCompositionSegment({
    composition: nestedComp,
    trackId: tracks.middle,
    startTime: 0.55,
    name: 'main nested comp overlay',
  });
  updateClipVisuals(nestedClip.id, {
    transform: {
      ...nestedClip.transform,
      opacity: 0.72,
      blendMode: 'soft-light',
      position: { x: -0.2, y: 0.02, z: 0 },
      scale: { x: 0.58, y: 0.58 },
    },
  });
  const nestedMaskId = useTimelineStore.getState().addEllipseMask(nestedClip.id);
  useTimelineStore.getState().updateMask(nestedClip.id, nestedMaskId, {
    name: 'main nested vignette ellipse',
    feather: 34,
    featherQuality: 82,
    opacity: 0.9,
    position: { x: -0.02, y: 0.02 },
  });

  const topClip = await addMediaSegment({
    media: ctx.blend,
    trackId: tracks.top,
    startTime: 1.35,
    inPoint: 2.2,
    outPoint: Math.min(5.6, ctx.blend.duration ?? 5.6),
    name: 'main additive mask color layer',
  });
  updateClipVisuals(topClip.id, {
    transform: {
      ...topClip.transform,
      opacity: 0.48,
      blendMode: 'screen',
      position: { x: 0.18, y: -0.14, z: 0 },
      scale: { x: 0.46, y: 0.46 },
    },
  });
  addEffect(topClip.id, 'contrast', { amount: 1.18 });
  addEffect(topClip.id, 'edge-detect', { strength: 0.72, invert: false });
  addPolygonMask(topClip.id, 'main polygon color mask', [
    { x: 0.1, y: 0.16 },
    { x: 0.72, y: 0.1 },
    { x: 0.92, y: 0.72 },
    { x: 0.38, y: 0.92 },
    { x: 0.06, y: 0.58 },
  ], { feather: 22, featherQuality: 72 });
  addNumericKeyframes(topClip.id, 'opacity', [
    { time: 0, value: 0.1 },
    { time: 1.1, value: 0.52 },
    { time: 3.4, value: 0.22 },
  ]);

  timelineStore.addMarker(0.25, 'fixture-start', '#59d38c');
  timelineStore.addMarker(3.2, 'transition-check', '#f5c542');
  timelineStore.addMarker(5.75, 'nested-export-check', '#5da7ff');
  timelineStore.setPlayheadPosition(0.25);
  saveActiveTimelineToComposition(mainComp.id, ctx.durationSeconds);
  renderHostPort.requestRender();
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  return useMediaStore.getState().compositions.find((entry) => entry.id === mainComp.id) ?? mainComp;
}
