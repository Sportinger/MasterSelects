/** CRT Screen recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const CRT_MASK_OPTIONS = [{ value: 'aperture', label: 'Aperture Grille' }, { value: 'slot', label: 'Slot Mask' }];
/** Line Count range of the control and of the recipe (one range: values outside it are reported and clamped). */
export const CRT_LINE_COUNT_RANGE = [16, 1080] as const;
export const CRT_MASK_SIZE_RANGE = [0.5, 12] as const;
/** Lines closer than this many output pixels fade out (they cannot be drawn without aliasing). */
export const CRT_MIN_LINE_PX = 2.25;
/** Mask stripes narrower than this many output pixels fade out. */
export const CRT_MIN_STRIPE_PX = 1;
