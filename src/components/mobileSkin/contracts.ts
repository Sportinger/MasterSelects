// Shared contracts of the phone skin served at /m.
// Every module under src/components/mobileSkin/ builds against these names; change them only
// together with all consumers. The skin reuses the editor's engine, stores, history, project
// format and export: nothing here describes a second timeline model.

/** Root class; all phone CSS is scoped beneath it. */
export const PHONE_SKIN_ROOT_CLASS = 'mobile-skin';

/** Stable selectors for Playwright journeys and unit tests. */
export const PHONE_TEST_IDS = {
  root: 'phone-root',
  bootStatus: 'phone-boot-status',
  topBar: 'phone-top-bar',
  projectName: 'phone-project-name',
  compositionTabs: 'phone-composition-tabs',
  previewRegion: 'phone-preview',
  /** Same id as the desktop preview canvas so the existing PreviewProbe works unchanged. */
  previewCanvas: 'preview-canvas',
  transport: 'phone-transport',
  play: 'phone-play',
  time: 'phone-time',
  undo: 'phone-undo',
  redo: 'phone-redo',
  timeline: 'phone-timeline',
  timelineSurface: 'phone-timeline-surface',
  playhead: 'phone-playhead',
  /** Every clip tile carries data-clip-id, data-track-id and aria-selected. */
  clip: 'phone-clip',
  toolbar: 'phone-toolbar',
  unavailableNotice: 'phone-unavailable-notice',
  toast: 'phone-toast',
  sheet: 'phone-sheet',
  sheetCancel: 'phone-sheet-cancel',
  sheetDone: 'phone-sheet-done',
} as const;

export function phoneActionTestId(actionId: string): string {
  return `phone-action-${actionId}`;
}

export type PhoneMilestone = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6';

/** The milestone currently shipped by the skin; later actions render greyed out with a reason. */
/** Where an unavailable tool points meanwhile: the full editor, reached from the project sheet. */
export const PHONE_FULL_EDITOR_HINT = 'Use the full editor meanwhile: tap the project name, then Full editor.';

export const PHONE_SHIPPED_MILESTONE: PhoneMilestone = 'M2';

const MILESTONE_ORDER: readonly PhoneMilestone[] = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

export function isMilestoneShipped(milestone: PhoneMilestone, shipped: PhoneMilestone = PHONE_SHIPPED_MILESTONE): boolean {
  return MILESTONE_ORDER.indexOf(milestone) <= MILESTONE_ORDER.indexOf(shipped);
}

// ---------------------------------------------------------------------------
// Actions: root toolbar, clip toolbar, sheets and handles share one contract.
// ---------------------------------------------------------------------------

/** root = nothing selected; clip = at least one clip selected. */
export type PhoneToolbarScope = 'root' | 'clip';

export type PhoneActionAvailability =
  | { kind: 'available' }
  /** Visible, aria-disabled, and tapping it shows `reason` (owner rule: grey out, never hide). */
  | { kind: 'unavailable'; reason: string };

export interface PhoneActionContext {
  selectedClipIds: readonly string[];
  playheadTime: number;
  projectOpen: boolean;
  engineReady: boolean;
}

export type PhoneActionResult = { ok: true; message?: string } | { ok: false; message: string };

/** Neutral glyph names drawn by shell/phoneIcons.tsx (no third-party artwork). */
export type PhoneIconName =
  | 'split' | 'trim' | 'delete' | 'duplicate' | 'speed' | 'volume' | 'animation' | 'effects'
  | 'filters' | 'adjust' | 'text' | 'audio' | 'overlay' | 'format' | 'media' | 'transition'
  | 'mask' | 'keyframe' | 'crop' | 'replace' | 'assistant' | 'nodes' | 'color' | 'captions'
  | 'more' | 'play' | 'pause' | 'undo' | 'redo' | 'back' | 'export' | 'fullscreen' | 'plus'
  | 'compositions' | 'reorder' | 'close' | 'check';

export interface PhoneActionDefinition {
  id: string;
  label: string;
  icon: PhoneIconName;
  scope: PhoneToolbarScope;
  /** Milestone that makes this action work on the phone. */
  milestone: PhoneMilestone;
  /** Called only when the milestone is shipped; decides the concrete state (e.g. no selection). */
  availability?: (context: PhoneActionContext) => PhoneActionAvailability;
  /** Reason shown while the milestone is not shipped yet. */
  pendingReason?: string;
  run?: (context: PhoneActionContext) => PhoneActionResult | Promise<PhoneActionResult>;
}

// ---------------------------------------------------------------------------
// Runtime: one owner of engine, playback, history and project boot.
// ---------------------------------------------------------------------------

export interface PhoneRuntimeStatus {
  bootPending: boolean;
  projectOpen: boolean;
  permissionPending: boolean;
  bootError: string | null;
  engineReady: boolean;
  engineError: string | null;
}

export interface PhoneHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export interface PhoneRuntimeValue {
  status: PhoneRuntimeStatus;
  history: PhoneHistoryControls;
}

// ---------------------------------------------------------------------------
// Timeline viewport: fixed centre playhead, phone-local scroll and zoom.
// ---------------------------------------------------------------------------

/** Pixels per second. Phone-local; the desktop timeline zoom/scroll is never written. */
export const PHONE_TIMELINE_DEFAULT_ZOOM = 60;
export const PHONE_TIMELINE_MIN_ZOOM = 4;
export const PHONE_TIMELINE_MAX_ZOOM = 1200;

export interface PhoneTimelineViewport {
  /** Visible width of the timeline surface in CSS pixels. */
  width: number;
  /** Pixels per second. */
  zoom: number;
}

// ---------------------------------------------------------------------------
// Phone UI state (state/phoneUiStore.ts): serializable view state only, never clips,
// tracks, files, media elements or GPU objects.
// ---------------------------------------------------------------------------

export interface PhoneUnavailableNotice {
  actionId: string;
  label: string;
  reason: string;
}

export interface PhoneToastMessage {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

export interface PhoneUiState {
  /** Phone timeline zoom in pixels per second. */
  timelineZoom: number;
  unavailableNotice: PhoneUnavailableNotice | null;
  toast: PhoneToastMessage | null;
  /** Id of the open bottom sheet (M1+), null when none. */
  activeSheet: string | null;
  setTimelineZoom: (zoom: number) => void;
  showUnavailable: (notice: PhoneUnavailableNotice) => void;
  dismissUnavailable: () => void;
  showToast: (message: string, tone?: PhoneToastMessage['tone']) => void;
  dismissToast: () => void;
  openSheet: (sheetId: string) => void;
  closeSheet: () => void;
}

// ---------------------------------------------------------------------------
// Bottom sheets (M1): one modal sheet at a time, Cancel discards, Done commits once.
// ---------------------------------------------------------------------------

/** Sheet ids known to sheets/phoneSheetRegistry.tsx. */
export type PhoneSheetId =
  | 'projects' | 'media' | 'title' | 'export' | 'assistant'
  // M2 design sheets.
  | 'effects' | 'filters' | 'adjust' | 'transition' | 'speed' | 'volume' | 'audio' | 'animation'
  | 'keyframe' | 'mask' | 'crop' | 'overlay' | 'format';

export interface PhoneSheetProps {
  title: string;
  /** 'half' keeps the preview large; 'tall' for forms and lists. The preview never unmounts. */
  height?: 'half' | 'tall';
  onCancel: () => void;
  /** Omit for sheets that only have Close (e.g. export result). */
  onDone?: () => void;
  doneLabel?: string;
  doneDisabled?: boolean;
  cancelLabel?: string;
  children: import('react').ReactNode;
}

/** Every sheet component takes no props and closes itself through usePhoneUiStore().closeSheet. */
export type PhoneSheetComponent = () => import('react').ReactElement | null;

/** M1 selectors (home, sheets, import, title, export, trim). */
export const PHONE_M1_TEST_IDS = {
  home: 'phone-home',
  newProject: 'phone-new-project',
  /** One chip per format; suffix is the format id ('9:16', '16:9', '1:1', '4:5'). */
  formatChip: 'phone-format-chip',
  createProject: 'phone-create-project',
  projectNameInput: 'phone-project-name-input',
  projectRow: 'phone-project-row',
  importArchive: 'phone-import-archive',
  storageStatus: 'phone-storage-status',
  mediaPickVisual: 'phone-media-pick-visual',
  mediaPickAudio: 'phone-media-pick-audio',
  /** The hidden <input type=file> elements behind the two pick buttons (for setInputFiles). */
  mediaInputVisual: 'phone-media-input-visual',
  mediaInputAudio: 'phone-media-input-audio',
  mediaPickedItem: 'phone-media-picked-item',
  mediaProgress: 'phone-media-progress',
  titleInput: 'phone-title-input',
  trimHandleStart: 'phone-trim-start',
  trimHandleEnd: 'phone-trim-end',
  exportStart: 'phone-export-start',
  exportProgress: 'phone-export-progress',
  exportCancel: 'phone-export-cancel',
  exportShare: 'phone-export-share',
  exportSave: 'phone-export-save',
  exportSummary: 'phone-export-summary',
  /** Leaves the phone editor for the full editor (project sheet and home). */
  fullEditor: 'phone-full-editor',
} as const;

export type PhoneProjectFormatId = '9:16' | '16:9' | '1:1' | '4:5';

/** Composition size per format for a new phone project (30 fps). */
export const PHONE_PROJECT_FORMATS: Readonly<Record<PhoneProjectFormatId, { width: number; height: number }>> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};
