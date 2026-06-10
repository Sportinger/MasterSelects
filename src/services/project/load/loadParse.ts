import { Logger } from '../../logger';
import { projectFileService, type ProjectFile } from '../../projectFileService';

const log = Logger.create('ProjectSync');

export type ProjectLoadParseResult = {
  projectData: ProjectFile;
  hydrateFiles: boolean;
};

export function readProjectDataForLoad(): ProjectLoadParseResult | null {
  const projectData = projectFileService.getProjectData();
  if (!projectData) {
    log.error(' No project data to load');
    return null;
  }

  const hydrateFiles = projectFileService.activeBackend !== 'native';
  if (!hydrateFiles) {
    log.info('Native backend detected; deferring media file hydration until after project metadata is loaded');
  }

  return { projectData, hydrateFiles };
}
