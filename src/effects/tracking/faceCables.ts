import type { EffectDefinition } from '../types';
import { CABLE_UNIFORM_SIZE, packFaceCableUniforms } from './faceCableUniforms';
import shader from './faceCables.wgsl?raw';

/** Authored alongside precise face tracking; all cable geometry is portable project data. */
export const faceCables: EffectDefinition = {
  id: 'face-cables', name: 'Face Cables', category: 'tracking', shader,
  entryPoint: 'faceCablesFragment', uniformSize: CABLE_UNIFORM_SIZE,
  params: {
    scene3D: { type: 'boolean', label: 'Native 3D scene', default: false, hidden: true, animatable: false },
    sceneData: { type: 'text', label: 'Baked 3D geometry', default: '', hidden: true, animatable: false },
    faceShadows: { type: 'boolean', label: 'Face shadows', default: false, hidden: true, animatable: false },
    lightHorizontal: { type: 'number', label: 'Light horizontal', default: -30, min: -75, max: 75, step: 1, hidden: true, animatable: false },
    lightVertical: { type: 'number', label: 'Light vertical', default: -35, min: -75, max: 75, step: 1, hidden: true, animatable: false },
    shadowStrength: { type: 'number', label: 'Shadow strength', default: 0.65, min: 0, max: 1, step: 0.01, hidden: true, animatable: false },
    shadowSoftness: { type: 'number', label: 'Shadow softness', default: 0.04, min: 0, max: 0.3, step: 0.01, hidden: true, animatable: false },
    sharedWind: { type: 'boolean', label: 'Shared wind', default: false, hidden: true, animatable: false },
    faceCollision: { type: 'boolean', label: 'Face collision', default: false, hidden: true, animatable: false },
    globalWindStrength: { type: 'number', label: 'Shared wind strength', default: 5, min: 0, max: 30, step: 0.1, hidden: true, animatable: true },
    globalWindYaw: { type: 'number', label: 'Shared wind direction', default: 0, min: -180, max: 180, step: 0.1, hidden: true, animatable: true },
    globalWindPitch: { type: 'number', label: 'Shared wind elevation', default: 0, min: -90, max: 90, step: 0.1, hidden: true, animatable: true },
    globalWindGusts: { type: 'number', label: 'Shared wind gusts', default: 0.25, min: 0, max: 1, step: 0.05, hidden: true, animatable: true },
    bakedData: { type: 'text', label: 'Baked cables', default: '', hidden: true, animatable: false },
    settings: { type: 'text', label: 'Cable settings', default: '[]', hidden: true, animatable: false },
    // Renderer-owned clip-local time, not an authored slider or keyframe value.
    cableTime: { type: 'number', label: 'Cable time', default: 0, hidden: true, animatable: false },
  },
  extraControls: () => import('../../components/panels/properties/FaceCableControls'),
  packUniforms: packFaceCableUniforms,
};
