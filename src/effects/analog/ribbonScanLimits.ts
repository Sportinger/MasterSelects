/** Ribbon Scan recipe constants shared by the effect definition (inspector, tool notes) and its graph. */
export const RIBBON_SCAN_EDGE_OPTIONS = [{ value: 'mirror', label: 'Mirror' }, { value: 'wrap', label: 'Wrap' }];
/** Fewer ribbons than this render as this many (said in the tool and inspector notes). */
export const RIBBON_SCAN_MIN_RIBBONS = 3;
/** Sideways shift at Displacement 1, in frame widths; the shift grows with Displacement squared. */
export const RIBBON_SCAN_REACH = 0.06;
