import gentilisBold from '../fonts/gentilis_bold.typeface.json';
import gentilisRegular from '../fonts/gentilis_regular.typeface.json';
import helvetikerBold from '../fonts/helvetiker_bold.typeface.json';
import helvetikerRegular from '../fonts/helvetiker_regular.typeface.json';
import optimerBold from '../fonts/optimer_bold.typeface.json';
import optimerRegular from '../fonts/optimer_regular.typeface.json';
import type { FontData, TextMeshFontFamily, TextMeshFontWeight } from './types';

export const TEXT_3D_FONT_DATA: Record<
  TextMeshFontFamily,
  Record<TextMeshFontWeight, FontData>
> = {
  helvetiker: {
    regular: helvetikerRegular as FontData,
    bold: helvetikerBold as FontData,
  },
  optimer: {
    regular: optimerRegular as FontData,
    bold: optimerBold as FontData,
  },
  gentilis: {
    regular: gentilisRegular as FontData,
    bold: gentilisBold as FontData,
  },
};
