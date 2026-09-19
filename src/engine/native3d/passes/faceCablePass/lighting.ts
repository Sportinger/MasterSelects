import type { SceneLightLayer } from '../../../scene/types';
import { lookAt, perspective } from '../../../scene/cameraUtils/projectionMatrices';
import { multiplyMat4 } from '../../../scene/SceneTransformUtils';
import { hexToRgb01 } from '../../../../types/light';

export function cableSceneLights(lights: SceneLightLayer[], center: number[]) {
  return lights.filter(l => l.lightSettings.kind !== 'environment' && l.lightSettings.intensity > 0).slice(0, 4).map(light => {
    const m = light.worldMatrix, p = [m[12], m[13], m[14]], settings = light.lightSettings;
    const distance = Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]);
    const view = lookAt(...p as [number, number, number], ...center as [number, number, number], 0, Math.abs(p[1] - center[1]) / Math.max(0.001, distance) > 0.99 ? 0 : 1, Math.abs(p[1] - center[1]) / Math.max(0.001, distance) > 0.99 ? 1 : 0);
    const projection = multiplyMat4(perspective(90 * Math.PI / 180, 1, 0.1, Math.max(50, distance * 4)), view);
    const data = new Float32Array(32); data.set(projection); data.set([...p, 1], 16);
    data.set([...hexToRgb01(settings.color), settings.intensity * light.opacity], 20);
    data.set([settings.castsShadows ? settings.shadowStrength : 0, Math.max(0.5, Math.min(8, settings.diameter)), settings.kind === 'panel' ? 1 : 0, 0], 24);
    const direction = [-m[8], -m[9], -m[10]], len = Math.hypot(...direction) || 1;
    data.set(direction.map(v => v / len), 28);
    return { projection, data, shadows: settings.castsShadows && distance > 0.01 };
  });
}
