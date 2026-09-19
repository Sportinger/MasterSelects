import type { DockSliceCreator, OverLayoutModeActions } from './storeTypes';

export const createOverLayoutModeActions: DockSliceCreator<OverLayoutModeActions> = (set) => ({
  setOverLayoutBaseId: (overLayoutBaseId) => set({ overLayoutBaseId }),
  setMediumLayoutOverride: (mediumLayoutOverride) => set({ mediumLayoutOverride }),
  setMobileLayoutOverride: (mobileLayoutOverride) => set({ mobileLayoutOverride }),
});
