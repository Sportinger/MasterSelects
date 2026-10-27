// The landscape editors of the phone (M4): each is a desktop workspace panel in the middle with
// collapsible side panels left and right. The panels are the desktop components themselves
// (DockPanelContent), so nodes, mixer, colour and the rest behave exactly like on the desktop.

import type { PanelType } from '../../../types/dock';

export type PhoneWorkspaceId = 'nodes' | 'mixer' | 'multicam' | 'pianoRoll' | 'scene3d' | 'curves' | 'color' | 'output';

export type PhoneWorkspaceSide = 'left' | 'right';

/** What a workspace area shows: a desktop dock panel, or a phone-specific view rendered by the packet. */
export type PhoneWorkspaceContent =
  | { kind: 'panel'; type: PanelType; title: string }
  | { kind: 'custom'; id: string; title: string };

export interface PhoneWorkspaceDefinition {
  id: PhoneWorkspaceId;
  title: string;
  /** One line for the editors list. */
  summary: string;
  main: PhoneWorkspaceContent;
  left?: PhoneWorkspaceContent;
  right?: PhoneWorkspaceContent;
}

export const PHONE_WORKSPACES: readonly PhoneWorkspaceDefinition[] = [
  {
    id: 'nodes', title: 'Nodes', summary: 'Build and wire effect and clip node graphs',
    main: { kind: 'panel', type: 'node-workspace', title: 'Nodes' },
    left: { kind: 'panel', type: 'preview', title: 'Preview' },
    right: { kind: 'panel', type: 'clip-properties', title: 'Properties' },
  },
  {
    id: 'mixer', title: 'Mixer', summary: 'Levels, pan, sends and master of every track',
    main: { kind: 'panel', type: 'audio-mixer', title: 'Audio Mixer' },
    left: { kind: 'panel', type: 'preview', title: 'Preview' },
    right: { kind: 'panel', type: 'clip-properties', title: 'Properties' },
  },
  {
    id: 'multicam', title: 'Multicam', summary: 'Watch every angle and cut between them',
    main: { kind: 'panel', type: 'multi-preview', title: 'Multi Preview' },
    right: { kind: 'panel', type: 'clip-properties', title: 'Properties' },
  },
  {
    id: 'pianoRoll', title: 'Piano roll', summary: 'Edit the notes of the selected MIDI clip',
    main: { kind: 'custom', id: 'piano-roll', title: 'Piano roll' },
    left: { kind: 'panel', type: 'preview', title: 'Preview' },
    right: { kind: 'panel', type: 'clip-properties', title: 'Properties' },
  },
  {
    id: 'scene3d', title: '3D scene', summary: 'Place and light 3D objects, splats and cameras',
    main: { kind: 'panel', type: 'preview', title: '3D scene' },
    left: { kind: 'panel', type: 'layers', title: 'Layers' },
    right: { kind: 'panel', type: 'clip-properties', title: 'Properties' },
  },
  {
    id: 'curves', title: 'Curves', summary: 'Shape keyframe curves and easing',
    main: { kind: 'panel', type: 'curves', title: 'Curves' },
    left: { kind: 'panel', type: 'preview', title: 'Preview' },
    right: { kind: 'panel', type: 'clip-properties', title: 'Properties' },
  },
  {
    id: 'color', title: 'Colour', summary: 'Wheels, curves, colour nodes and scopes',
    main: { kind: 'panel', type: 'color-controls', title: 'Color Controls' },
    left: { kind: 'panel', type: 'color-scopes', title: 'Scopes' },
    right: { kind: 'panel', type: 'color-nodes', title: 'Color Nodes' },
  },
  {
    id: 'output', title: 'Output', summary: 'Projector outputs: sources, slices, corner pin, masks',
    main: { kind: 'custom', id: 'output-stage', title: 'Output' },
    left: { kind: 'custom', id: 'output-targets', title: 'Outputs' },
    right: { kind: 'custom', id: 'output-slices', title: 'Slices' },
  },
];

export function getPhoneWorkspace(id: PhoneWorkspaceId): PhoneWorkspaceDefinition | undefined {
  return PHONE_WORKSPACES.find((workspace) => workspace.id === id);
}

const COLLAPSE_KEY = 'ms.phoneWorkspace.collapsed';

type CollapsedState = Partial<Record<PhoneWorkspaceId, Partial<Record<PhoneWorkspaceSide, boolean>>>>;

function readCollapsed(): CollapsedState {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as CollapsedState : {};
  } catch {
    return {};
  }
}

/** The person's stored choice for one side of one editor; undefined while they never toggled it. */
export function readPhoneWorkspaceSideChoice(id: PhoneWorkspaceId, side: PhoneWorkspaceSide): boolean | undefined {
  const value = readCollapsed()[id]?.[side];
  return typeof value === 'boolean' ? value : undefined;
}

/** Stored choice, or collapsed when nothing is stored (callers that know the room use `defaultPhoneWorkspaceSidesOpen`). */
export function isPhoneWorkspaceSideCollapsed(id: PhoneWorkspaceId, side: PhoneWorkspaceSide): boolean {
  return readPhoneWorkspaceSideChoice(id, side) === true;
}

/** Width of one open side panel; mirrors `clamp(180px, 28vw, 340px)` in PhoneWorkspace.css. */
export function phoneWorkspaceSideWidth(viewportWidth: number): number {
  return Math.min(340, Math.max(180, viewportWidth * 0.28));
}

/** The editor in the middle keeps at least this much width before side panels open on their own. */
export const PHONE_WORKSPACE_MIN_MAIN_WIDTH = 320;

/**
 * Whether side panels the person never toggled start open: only in landscape and only when the editor
 * in the middle keeps PHONE_WORKSPACE_MIN_MAIN_WIDTH next to every side panel the editor has.
 */
export function defaultPhoneWorkspaceSidesOpen(width: number, height: number, sides: number): boolean {
  if (sides === 0) return false;
  if (width <= height) return false;
  return width - sides * phoneWorkspaceSideWidth(width) >= PHONE_WORKSPACE_MIN_MAIN_WIDTH;
}

export function setPhoneWorkspaceSideCollapsed(id: PhoneWorkspaceId, side: PhoneWorkspaceSide, collapsed: boolean): void {
  const state = readCollapsed();
  state[id] = { ...state[id], [side]: collapsed };
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
}
