import {
  FACTORY_MEDIUM_EDIT_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VERTICAL_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from './panelRegistry';

export type WorkspaceOverLayout = 'medium' | 'mobile';

export function getWorkspaceOverLayout(
  layoutId: string | null,
): WorkspaceOverLayout | null {
  if (layoutId === FACTORY_MEDIUM_EDIT_LAYOUT_ID) return 'medium';
  if (
    layoutId === FACTORY_MOBILE_LAYOUT_ID
    || layoutId === FACTORY_VERTICAL_MOBILE_LAYOUT_ID
  ) return 'mobile';
  return null;
}

export function isWorkspaceOverLayoutId(layoutId: string | null): boolean {
  return getWorkspaceOverLayout(layoutId) !== null;
}

export function getVisibleSubLayoutId(
  activeLayoutId: string | null,
  overLayoutBaseId: string | null,
): string | null {
  if (!isWorkspaceOverLayoutId(activeLayoutId)) return activeLayoutId;
  return !isWorkspaceOverLayoutId(overLayoutBaseId)
    ? overLayoutBaseId ?? FACTORY_VIDEO_EDIT_LAYOUT_ID
    : FACTORY_VIDEO_EDIT_LAYOUT_ID;
}
