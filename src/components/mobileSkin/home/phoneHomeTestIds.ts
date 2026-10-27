// Selectors and copy of the phone home that tests share.
export const PHONE_HOME_TEST_IDS = {
  templates: 'phone-home-templates',
  settings: 'phone-home-settings',
  welcome: 'phone-home-welcome',
  welcomeStart: 'phone-home-welcome-start',
  welcomeSkip: 'phone-home-welcome-skip',
  /** Shown when the last folder project waits for folder access; data-project-name. */
  resumeCard: 'phone-home-resume-card',
  resume: 'phone-home-resume',
  openFolder: 'phone-home-open-folder',
} as const;

/** Ready-made project templates do not exist in the editor; looks and motion templates live inside a project. */
export const TEMPLATES_NOTE = 'Ready-made project templates are not in MasterSelects yet, on the phone or the desktop. '
  + 'Looks are: open a project, select a clip and tap Filters. Motion templates of shape clips are in All tools > Properties.';

/** Remembers on this device that the first-run welcome was started or skipped. */
export const PHONE_WELCOME_STORAGE_KEY = 'ms.phoneEditor.welcomeSeen';
