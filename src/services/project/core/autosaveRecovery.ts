import type { ProjectFile } from '../types';

function clipCount(project: ProjectFile): number {
  return project.compositions.reduce((count, composition) => count + composition.clips.length, 0);
}

function generatedItemCount(project: ProjectFile): number {
  return (project.textItems?.length ?? 0)
    + (project.solidItems?.length ?? 0)
    + (project.meshItems?.length ?? 0)
    + (project.cameraItems?.length ?? 0)
    + (project.splatEffectorItems?.length ?? 0);
}

export function hasMeaningfulContent(project: ProjectFile): boolean {
  return project.media.length > 0
    || project.folders.length > 0
    || project.compositions.length > 1
    || clipCount(project) > 0
    || generatedItemCount(project) > 0
    || Boolean(project.flashboard?.boards?.some((board) => board.nodes.length > 0));
}

export function looksLikeFreshEmptyProject(project: ProjectFile): boolean {
  return project.media.length === 0
    && project.folders.length === 0
    && project.compositions.length <= 1
    && clipCount(project) === 0
    && generatedItemCount(project) === 0;
}

export function shouldPreferAutosave(projectData: ProjectFile, autosaveData: ProjectFile | null): boolean {
  if (!autosaveData) {
    return false;
  }

  const projectUpdatedAt = Date.parse(projectData.updatedAt);
  const autosaveUpdatedAt = Date.parse(autosaveData.updatedAt);

  if (autosaveUpdatedAt > projectUpdatedAt) {
    return true;
  }

  return looksLikeFreshEmptyProject(projectData) && hasMeaningfulContent(autosaveData);
}

export function shouldSkipEmptyProjectSave(projectData: ProjectFile, autosaveData: ProjectFile | null): boolean {
  if (!autosaveData) {
    return false;
  }

  return looksLikeFreshEmptyProject(projectData) && hasMeaningfulContent(autosaveData);
}
