import type { SliceCreator, TimelineToolActions, TimelineToolGroupId, TimelineToolId } from './types';
import {
  AVAILABLE_TIMELINE_MODE_TOOL_IDS,
  DEFAULT_TIMELINE_TOOL_BY_GROUP,
  TIMELINE_TOOL_GROUP_BY_ID,
  TIMELINE_TOOL_IDS_BY_GROUP,
  getDefaultLastTimelineToolByGroup,
  getLegacyToolMode,
} from './toolDefaults';

function getModeToolsForGroup(groupId: TimelineToolGroupId): TimelineToolId[] {
  return TIMELINE_TOOL_IDS_BY_GROUP[groupId].filter((toolId) => AVAILABLE_TIMELINE_MODE_TOOL_IDS.has(toolId));
}

export const createToolSlice: SliceCreator<TimelineToolActions> = (set, get) => ({
  setActiveTimelineTool: (toolId) => {
    const groupId = TIMELINE_TOOL_GROUP_BY_ID[toolId];
    const { activeTimelineToolId, lastTimelineToolByGroup } = get();

    set({
      activeTimelineToolId: toolId,
      previousTimelineToolId: activeTimelineToolId === toolId ? get().previousTimelineToolId : activeTimelineToolId,
      lastTimelineToolByGroup: {
        ...lastTimelineToolByGroup,
        [groupId]: toolId,
      },
      openTimelineToolGroupId: null,
      momentaryTimelineToolId: null,
      timelineToolPreview: null,
      toolMode: getLegacyToolMode(toolId),
    });
  },

  activateTimelineToolGroup: (groupId) => {
    const { lastTimelineToolByGroup } = get();
    const lastTool = lastTimelineToolByGroup[groupId] ?? DEFAULT_TIMELINE_TOOL_BY_GROUP[groupId];
    if (!AVAILABLE_TIMELINE_MODE_TOOL_IDS.has(lastTool)) return;
    get().setActiveTimelineTool(lastTool);
  },

  cycleTimelineToolGroup: (groupId, direction = 1) => {
    const tools = getModeToolsForGroup(groupId);
    if (tools.length === 0) return;

    const activeToolId = get().activeTimelineToolId;
    const currentIndex = Math.max(0, tools.indexOf(activeToolId));
    const nextIndex = (currentIndex + direction + tools.length) % tools.length;
    get().setActiveTimelineTool(tools[nextIndex]);
  },

  setOpenTimelineToolGroup: (groupId) => {
    set({ openTimelineToolGroupId: groupId });
  },

  setMomentaryTimelineTool: (toolId) => {
    const { activeTimelineToolId } = get();
    set({
      previousTimelineToolId: activeTimelineToolId,
      momentaryTimelineToolId: toolId,
      activeTimelineToolId: toolId,
      timelineToolPreview: null,
      toolMode: getLegacyToolMode(toolId),
    });
  },

  clearMomentaryTimelineTool: () => {
    const { momentaryTimelineToolId, previousTimelineToolId } = get();
    if (!momentaryTimelineToolId) return;
    const nextToolId = previousTimelineToolId ?? 'select';
    set({
      activeTimelineToolId: nextToolId,
      previousTimelineToolId: null,
      momentaryTimelineToolId: null,
      timelineToolPreview: null,
      toolMode: getLegacyToolMode(nextToolId),
    });
  },

  setTimelineRangeSelection: (selection) => {
    if (!selection) {
      set({ timelineRangeSelection: null });
      return;
    }

    const startTime = Math.max(0, Math.min(selection.startTime, selection.endTime));
    const endTime = Math.max(startTime, Math.max(selection.startTime, selection.endTime));
    set({
      timelineRangeSelection: {
        ...selection,
        startTime,
        endTime,
        trackIds: [...selection.trackIds],
      },
    });
  },

  clearTimelineRangeSelection: () => {
    set({ timelineRangeSelection: null });
  },

  setTimelineToolPreview: (preview) => {
    set({ timelineToolPreview: preview });
  },
});

export { getDefaultLastTimelineToolByGroup };
