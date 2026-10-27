// Stable selectors of the replace sheet.

export const PHONE_REPLACE_TEST_IDS = {
  status: 'phone-replace-status',
  pickDevice: 'phone-replace-pick',
  /** The hidden <input type=file> behind the pick button (for setInputFiles). */
  input: 'phone-replace-input',
  progress: 'phone-replace-progress',
  /** One button per video of the project: data-media-id, aria-pressed. */
  media: 'phone-replace-media',
  /** One button per composition that can stand in: data-composition-id. */
  composition: 'phone-replace-composition',
  message: 'phone-replace-message',
  unsupported: 'phone-replace-unsupported',
} as const;
