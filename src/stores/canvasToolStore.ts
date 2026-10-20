// Active pointer tool for the Preview canvas, shared by the Tools panel,
// tool shortcuts and Preview pointer routing. Timeline tools keep their own
// state in the timeline store; the Tools panel switches between both.

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

/** Pointer modes of the canvas. Mask and AI Segment tools follow their own state. */
export type CanvasToolId = 'move' | 'hand' | 'zoom' | 'text';

/** Surface the Tools panel and tool shortcuts act on: the last one clicked. */
export type ToolTarget = 'canvas' | 'timeline';

interface CanvasToolState {
  activeCanvasTool: CanvasToolId;
  toolTarget: ToolTarget;
  setActiveCanvasTool: (tool: CanvasToolId) => void;
  setToolTarget: (target: ToolTarget) => void;
}

export const useCanvasToolStore = create<CanvasToolState>()(
  subscribeWithSelector((set) => ({
    activeCanvasTool: 'move',
    toolTarget: 'canvas',
    setActiveCanvasTool: (tool) => set({ activeCanvasTool: tool }),
    setToolTarget: (target) => set({ toolTarget: target }),
  })),
);
