import { COORDINATE_COMPOSITIONS } from './coordinateCompositions';
import { COLOR_COMPOSITIONS } from './colorCompositions';
import { FISHEYE_GROUP_COMPOSITIONS } from './fisheyeGroupCompositions';

export const IMAGE_COMPOSITIONS = [...COORDINATE_COMPOSITIONS, ...COLOR_COMPOSITIONS, ...FISHEYE_GROUP_COMPOSITIONS];
export const getOperatorComposition = (id: string) =>
  COORDINATE_COMPOSITIONS.find(definition => definition.id === id)
  ?? COLOR_COMPOSITIONS.find(definition => definition.id === id)
  ?? FISHEYE_GROUP_COMPOSITIONS.find(definition => definition.id === id);
