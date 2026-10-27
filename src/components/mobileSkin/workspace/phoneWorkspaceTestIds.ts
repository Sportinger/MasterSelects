export const PHONE_WORKSPACE_TEST_IDS = {
  root: 'phone-workspace',
  back: 'phone-workspace-back',
  undo: 'phone-workspace-undo',
  redo: 'phone-workspace-redo',
  toggleLeft: 'phone-workspace-toggle-left',
  toggleRight: 'phone-workspace-toggle-right',
  sideLeft: 'phone-workspace-side-left',
  sideRight: 'phone-workspace-side-right',
  main: 'phone-workspace-main',
  /** Thin rail a collapsed side leaves; tap or swipe inward opens it. */
  railLeft: 'phone-workspace-rail-left',
  railRight: 'phone-workspace-rail-right',
  /** Grip at the inner edge of an open side; swipe outward (or tap) closes it. */
  gripLeft: 'phone-workspace-grip-left',
  gripRight: 'phone-workspace-grip-right',
  /** Portrait only: a rotate icon that explains the landscape layout (replaces the wrapped hint text). */
  rotateHint: 'phone-workspace-rotate-hint',
  /** One row per editor in the 'editors' sheet; suffix is the workspace id. */
  editorRow: 'phone-editors-row',
} as const;
