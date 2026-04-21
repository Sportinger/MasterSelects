import type { SceneLayer3DData, SceneSplatLayer } from '../../scene/types';

export class SplatPass {
  supports(layer: SceneLayer3DData): layer is SceneSplatLayer {
    return layer.kind === 'splat';
  }

  collect(layers: SceneLayer3DData[]): SceneSplatLayer[] {
    return layers.filter((layer): layer is SceneSplatLayer => this.supports(layer));
  }
}
