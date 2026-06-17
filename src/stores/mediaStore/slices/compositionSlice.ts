// Composition CRUD and tab management

import type { Composition, MediaSliceCreator } from '../types';
import { createCompositionCrudActions } from './composition/crudActions';
import { createCompositionMonitorActions } from './composition/monitorActions';
import { createCompositionSlotAssignmentActions } from './composition/slotAssignmentActions';
import { createCompositionTabActions } from './composition/tabActions';

export interface CompositionSwitchOptions {
  skipAnimation?: boolean;
  playFromStart?: boolean;
  playFromTime?: number;
}

export interface CompositionActions {
  createComposition: (name: string, settings?: Partial<Composition>) => Composition;
  duplicateComposition: (id: string) => Composition | null;
  removeComposition: (id: string) => void;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
  setActiveComposition: (id: string | null) => void;
  getActiveComposition: () => Composition | undefined;
  openCompositionTab: (id: string, options?: CompositionSwitchOptions) => void;
  closeCompositionTab: (id: string) => void;
  getOpenCompositions: () => Composition[];
  reorderCompositionTabs: (fromIndex: number, toIndex: number) => void;
  assignMediaFileToSlot: (mediaFileId: string, slotIndex: number) => void;
  setPreviewComposition: (id: string | null) => void;
  setSourceMonitorFile: (id: string | null) => void;
  openSourceMonitorCrop: (id: string) => void;
  setSourceMonitorInPoint: (time: number | null) => void;
  setSourceMonitorOutPoint: (time: number | null) => void;
  clearSourceMonitorInOut: () => void;
}

export const createCompositionSlice: MediaSliceCreator<CompositionActions> = (set, get) => ({
  ...createCompositionCrudActions(set, get),
  ...createCompositionTabActions(set, get),
  ...createCompositionSlotAssignmentActions(set, get),
  ...createCompositionMonitorActions(set, get),
});
