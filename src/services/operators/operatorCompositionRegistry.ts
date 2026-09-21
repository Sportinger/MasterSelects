import { COORDINATE_COMPOSITIONS } from './coordinateCompositions';
import { FISHEYE_GROUP_COMPOSITIONS } from './fisheyeGroupCompositions';

export const IMAGE_COMPOSITIONS = [...COORDINATE_COMPOSITIONS, ...FISHEYE_GROUP_COMPOSITIONS];
export const getOperatorComposition = (id: string) =>
  COORDINATE_COMPOSITIONS.find(definition => definition.id === id)
  ?? FISHEYE_GROUP_COMPOSITIONS.find(definition => definition.id === id);
