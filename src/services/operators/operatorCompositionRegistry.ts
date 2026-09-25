import { COORDINATE_COMPOSITIONS } from './coordinateCompositions';
import { COLOR_COMPOSITIONS } from './colorCompositions';
import { FISHEYE_GROUP_COMPOSITIONS } from './fisheyeGroupCompositions';
import { GLYPH_COMPOSITIONS } from './glyphCompositions';
import { SAMPLING_COMPOSITIONS } from './samplingCompositions';
import { PROCESSING_COMPOSITIONS } from './processingCompositions';
import { SCREEN_COMPOSITIONS } from './screenCompositions';
import { SPLAT_COMPOSITIONS } from './splatCompositions';
import { TIME_FIELD_COMPOSITIONS } from './timeFieldCompositions';

export const IMAGE_COMPOSITIONS = [...COORDINATE_COMPOSITIONS, ...COLOR_COMPOSITIONS, ...SAMPLING_COMPOSITIONS,
  ...PROCESSING_COMPOSITIONS, ...GLYPH_COMPOSITIONS, ...SCREEN_COMPOSITIONS, ...FISHEYE_GROUP_COMPOSITIONS, ...TIME_FIELD_COMPOSITIONS];
export const SPACE_COMPOSITIONS = SPLAT_COMPOSITIONS;
const definitions = new Map([...IMAGE_COMPOSITIONS, ...SPACE_COMPOSITIONS].map(definition => [definition.id, definition]));
export const getOperatorComposition = (id: string) => definitions.get(id);
