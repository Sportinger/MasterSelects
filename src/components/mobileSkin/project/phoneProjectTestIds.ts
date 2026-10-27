// Stable selectors of the M3 project tools inside the 'projects' sheet.
export const PHONE_PROJECT_TEST_IDS = {
  tools: 'phone-project-tools',
  openLibrary: 'phone-project-open-library',
  openSettings: 'phone-project-open-settings',
  info: 'phone-project-info',
  duplicate: 'phone-project-duplicate',
  duplicateName: 'phone-project-duplicate-name',
  duplicateCreate: 'phone-project-duplicate-create',
  versions: 'phone-project-versions',
  versionName: 'phone-project-version-name',
  versionSave: 'phone-project-version-save',
  /** One per saved version; data-revision-id. */
  versionRow: 'phone-project-version-row',
  archive: 'phone-project-archive',
  archiveMedia: 'phone-project-archive-media',
  archivePrepare: 'phone-project-archive-prepare',
  archiveShare: 'phone-project-archive-share',
  archiveSave: 'phone-project-archive-save',
  status: 'phone-project-status',
} as const;

// Storage tools of the project sheet.
export const PHONE_PROJECT_STORAGE_TEST_IDS = {
  root: 'phone-project-storage',
  /** data-count is the number of temporary projects. */
  temporaryList: 'phone-project-temporary-list',
  temporaryMove: 'phone-project-temporary-move',
  backup: 'phone-project-backup',
  status: 'phone-project-storage-status',
} as const;
