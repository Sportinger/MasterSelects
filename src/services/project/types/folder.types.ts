// Folder organization types

export interface ProjectFolder {
  id: string;
  name: string;
  parentId: string | null;
  color?: string;
}
