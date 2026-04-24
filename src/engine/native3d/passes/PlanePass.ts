import type { SceneLayer3DData, ScenePlaneLayer } from '../../scene/types';

export class PlanePass {
  supports(layer: SceneLayer3DData): layer is ScenePlaneLayer {
    return layer.kind === 'plane';
  }

  collect(layers: SceneLayer3DData[]): ScenePlaneLayer[] {
    return layers.filter((layer): layer is ScenePlaneLayer => this.supports(layer));
  }
}
