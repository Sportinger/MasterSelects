export type MenuId = 'file' | 'edit' | 'view' | 'output' | 'info' | null;

export interface ToolbarShortcutLabels {
  new: string;
  open: string;
  save: string;
  saveAs: string;
  copy: string;
  paste: string;
}

export interface ToolbarMenuController {
  openMenu: MenuId;
  onMenuClick: (menuId: MenuId) => void;
  onMenuHover: (menuId: MenuId) => void;
}
