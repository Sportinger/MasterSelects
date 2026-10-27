// Stable selectors of the phone Library sheet ('library').
export const PHONE_LIBRARY_TEST_IDS = {
  root: 'phone-library',
  breadcrumb: 'phone-library-breadcrumb',
  /** Every row carries data-item-id and data-item-kind. */
  row: 'phone-library-row',
  rowOpen: 'phone-library-row-open',
  rowSelect: 'phone-library-row-select',
  empty: 'phone-library-empty',
  importButton: 'phone-library-import',
  importInput: 'phone-library-import-input',
  newFolder: 'phone-library-new-folder',
  folderNameInput: 'phone-library-folder-name',
  folderCreate: 'phone-library-folder-create',
  selectMode: 'phone-library-select-mode',
  moveSelected: 'phone-library-move-selected',
  deleteSelected: 'phone-library-delete-selected',
  duplicateSelected: 'phone-library-duplicate-selected',
  /** One per target folder in the move picker; data-folder-id ('' for the top level). */
  moveTarget: 'phone-library-move-target',
  relinkMissing: 'phone-library-relink-missing',
  relinkInput: 'phone-library-relink-input',
  proxyToggle: 'phone-library-proxy-toggle',
  // Item view.
  item: 'phone-library-item',
  itemName: 'phone-library-item-name',
  /** One chip per label colour; data-label is the colour key. */
  labelChip: 'phone-library-label',
  itemFolder: 'phone-library-item-folder',
  itemInfo: 'phone-library-item-info',
  addAtPlayhead: 'phone-library-add-at-playhead',
  duplicate: 'phone-library-duplicate',
  delete: 'phone-library-delete',
  regenerateThumbnail: 'phone-library-regen-thumbnail',
  regenerateWaveform: 'phone-library-regen-waveform',
  regenerateProxy: 'phone-library-regen-proxy',
  /** One per source option; data-source is 'auto' | 'original' | the linked source id. */
  sourceOption: 'phone-library-source',
  relinkItem: 'phone-library-relink-item',
  relinkItemInput: 'phone-library-relink-item-input',
  proxyLink: 'phone-library-proxy-link',
  proxyInput: 'phone-library-proxy-input',
  showInFiles: 'phone-library-show-in-files',
  copyName: 'phone-library-copy-name',
  openSource: 'phone-library-open-source',
  saveFile: 'phone-library-save-file',
  shareFile: 'phone-library-share-file',
  ocr: 'phone-library-ocr',
  jobsEntry: 'phone-library-jobs-entry',
  paste: 'phone-library-paste',
  // Delete confirmation.
  deleteConfirm: 'phone-library-delete-confirm',
  deleteUsage: 'phone-library-delete-usage',
  deleteConfirmButton: 'phone-library-delete-confirm-button',
  deleteKeepButton: 'phone-library-delete-keep',
  status: 'phone-library-status',
} as const;

// Library > Web sources.
export const PHONE_LIBRARY_WEB_TEST_IDS = {
  entry: 'phone-library-web-entry',
  root: 'phone-library-web',
  /** One chip per platform; data-platform. */
  platform: 'phone-library-web-platform',
  query: 'phone-library-web-query',
  /** data-mode is 'in-app' (YouTube with a saved key) or 'handoff' (opens the platform). */
  search: 'phone-library-web-search',
  searchMode: 'phone-library-web-search-mode',
  result: 'phone-library-web-result',
  link: 'phone-library-web-link',
  paste: 'phone-library-web-paste',
  open: 'phone-library-web-open',
  copy: 'phone-library-web-copy',
  download: 'phone-library-web-download',
  importFile: 'phone-library-web-import',
  importInput: 'phone-library-web-import-input',
  helperDownloads: 'phone-library-web-helper-downloads',
  status: 'phone-library-web-status',
} as const;

// Library > Storage and sequences.
export const PHONE_LIBRARY_MORE_TEST_IDS = {
  entry: 'phone-library-more-entry',
  root: 'phone-library-more',
  sequenceImport: 'phone-library-sequence-import',
  sequenceInput: 'phone-library-sequence-input',
  proxyLocation: 'phone-library-proxy-location',
  proxyFolder: 'phone-library-proxy-folder',
  warmUp: 'phone-library-warm-up',
  status: 'phone-library-more-status',
} as const;

// Media jobs sheet ('mediaJobs').
export const PHONE_MEDIA_JOBS_TEST_IDS = {
  root: 'phone-media-jobs',
  /** One per job; data-job-kind, data-job-state, data-file-id. */
  row: 'phone-media-jobs-row',
  /** data-action is stop | retry | show. */
  action: 'phone-media-jobs-action',
  hideDone: 'phone-media-jobs-hide-done',
  empty: 'phone-media-jobs-empty',
  status: 'phone-media-jobs-status',
} as const;
