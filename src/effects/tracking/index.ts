import { createTrackingEffect } from './trackingEffectFactory';
export { surfaceOverlay } from './surfaceOverlay';
export { terrainOverlay } from './terrainOverlay';
export { faceCables } from './faceCables';

export const subject = createTrackingEffect({ id: 'subject', name: 'Subject Highlight', entryPoint: 'subjectFragment', variant: 0 });
export const trackedScene = createTrackingEffect({ id: 'tracked-scene', name: 'Tracked Scene', entryPoint: 'trackedSceneFragment', variant: 1, animated: true });
export const hudTracker = createTrackingEffect({ id: 'hud-tracker', name: 'HUD Tracker', entryPoint: 'hudTrackerFragment', variant: 2, animated: true });
export const cctv = createTrackingEffect({ id: 'cctv', name: 'CCTV', entryPoint: 'cctvFragment', variant: 3, animated: true });
export const kineticTrace = createTrackingEffect({ id: 'kinetic-trace', name: 'Motion Trails', entryPoint: 'kineticTraceFragment', variant: 4, animated: true, feedback: true });
export const rainReveal = createTrackingEffect({ id: 'rain-reveal', name: 'Rain Reveal', entryPoint: 'rainRevealFragment', variant: 5, animated: true });
export const stardust = createTrackingEffect({ id: 'stardust', name: 'Stardust', entryPoint: 'stardustFragment', variant: 6, animated: true });
export const handParticles = createTrackingEffect({
  id: 'hand-particles', name: 'Hand Particles', entryPoint: 'handParticlesFragment', variant: 7, animated: true,
  params: {
    source: {
      type: 'select', label: 'Particle Source', default: 'fingertips', group: 'Tracking',
      options: [{ value: 'fingertips', label: 'Fingertips / Joints' }, { value: 'all', label: 'All Landmarks' }, { value: 'centroid', label: 'Centroid' }],
    },
  },
});
