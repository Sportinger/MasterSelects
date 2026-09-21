import { COORDINATE_COMPOSITIONS } from './coordinateCompositions';
import { COLOR_COMPOSITIONS } from './colorCompositions';
import { FISHEYE_GROUP_COMPOSITIONS } from './fisheyeGroupCompositions';
import { SAMPLING_COMPOSITIONS } from './samplingCompositions';
import { PROCESSING_COMPOSITIONS } from './processingCompositions';

export const IMAGE_COMPOSITIONS = [...COORDINATE_COMPOSITIONS, ...COLOR_COMPOSITIONS, ...SAMPLING_COMPOSITIONS, ...PROCESSING_COMPOSITIONS, ...FISHEYE_GROUP_COMPOSITIONS];
const definitions = new Map(IMAGE_COMPOSITIONS.map(definition => [definition.id, definition]));
export const getOperatorComposition = (id: string) => definitions.get(id);
