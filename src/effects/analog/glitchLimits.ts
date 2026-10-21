/** Glitch recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const GLITCH_BAND_RANGE = [1, 200] as const;
export const GLITCH_SEED_RANGE = [0, 9999] as const;
/** New glitch states per second of timeline time at Speed 1. */
export const GLITCH_STATES_PER_SECOND = 12;
/** States per cycle of the glitch clock (about 85 s at Speed 1); each cycle reseeds, so nothing visibly repeats. */
export const GLITCH_STATE_CYCLE = 1024;
