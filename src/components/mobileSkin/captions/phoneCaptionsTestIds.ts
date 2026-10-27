// Stable selectors of the phone Captions sheet (Playwright journeys and unit tests import them).

export const PHONE_CAPTIONS_TEST_IDS = {
  /** Section tabs; suffix is the section id ('generate', 'words', 'style', 'timing'). */
  sectionPrefix: 'phone-captions-section-',
  status: 'phone-captions-status',
  /** Caption clip chips (when the timeline has several); carry data-clip-id. */
  captionChip: 'phone-captions-clip-chip',
  // Generate
  account: 'phone-captions-account',
  /** Provider chips; carry data-provider and aria-pressed. */
  provider: 'phone-captions-provider',
  useLocal: 'phone-captions-use-local',
  openSettings: 'phone-captions-open-settings',
  /** One row per speech source; carries data-clip-id and data-transcript (none/transcribing/ready/error). */
  source: 'phone-captions-source',
  sourceTranscribe: 'phone-captions-source-transcribe',
  sourceState: 'phone-captions-source-state',
  transcribeAll: 'phone-captions-transcribe-all',
  cancelTranscription: 'phone-captions-cancel-transcription',
  /** Per-source 'Add captions' (bound to that clip). */
  sourceCreate: 'phone-captions-source-create',
  createTimeline: 'phone-captions-create-timeline',
  generateNote: 'phone-captions-generate-note',
  // Words
  empty: 'phone-captions-empty',
  /** One row per caption (word group); carries data-start/data-end. */
  group: 'phone-captions-group',
  groupJump: 'phone-captions-group-jump',
  /** Word chips; carry data-word-id and data-source-clip-id. */
  word: 'phone-captions-word',
  wordInput: 'phone-captions-word-input',
  wordSave: 'phone-captions-word-save',
  wordCut: 'phone-captions-word-cut',
  wordClose: 'phone-captions-word-close',
  wordError: 'phone-captions-word-error',
  deleteCaptions: 'phone-captions-delete',
  // Style
  /** Preset cards; carry data-preset and aria-pressed. */
  preset: 'phone-captions-preset',
  fontSize: 'phone-captions-font-size',
  fontSizeSlider: 'phone-captions-font-size-slider',
  /** Colour swatches; carry data-target ('text' | 'highlight' | 'background') and data-color. */
  swatch: 'phone-captions-swatch',
  uppercase: 'phone-captions-uppercase',
  outline: 'phone-captions-outline',
  background: 'phone-captions-background',
  highlight: 'phone-captions-highlight',
  /** Highlight mode / style chips; carry data-value. */
  highlightMode: 'phone-captions-highlight-mode',
  highlightStyle: 'phone-captions-highlight-style',
  positionY: 'phone-captions-position-y',
  positionYSlider: 'phone-captions-position-y-slider',
  allStyle: 'phone-captions-all-style',
  // Timing
  wordsPerCaption: 'phone-captions-words-per-caption',
  wordsPerCaptionSlider: 'phone-captions-words-per-caption-slider',
  gap: 'phone-captions-gap',
  gapSlider: 'phone-captions-gap-slider',
  hold: 'phone-captions-hold',
  holdSlider: 'phone-captions-hold-slider',
  lines: 'phone-captions-lines',
  linesSlider: 'phone-captions-lines-slider',
  /** Source chips ('auto' or a clip id in data-source). */
  sourceChoice: 'phone-captions-source-choice',
  /** Greyed rows; suffix is the row id. */
  unavailablePrefix: 'phone-captions-unavailable-',
} as const;
