// Test ids of the Advanced export and the batch queue (phone-export-<thing>). The basic export
// ids (start, progress, cancel, share, save, summary) stay in PHONE_M1_TEST_IDS.
import type { PhoneExportFormatId } from './phoneExportFormats';

export const PHONE_EXPORT_TEST_IDS = {
  advancedToggle: 'phone-export-advanced-toggle',
  advanced: 'phone-export-advanced',
  notice: 'phone-export-notice',
  finishEarly: 'phone-export-finish-early',
  resolutionCustomWidth: 'phone-export-custom-width',
  resolutionCustomHeight: 'phone-export-custom-height',
  fpsCustom: 'phone-export-custom-fps',
  bitrateCustom: 'phone-export-custom-bitrate',
  audioToggle: 'phone-export-audio',
  presetName: 'phone-export-preset-name',
  presetSave: 'phone-export-preset-save',
  presetDelete: 'phone-export-preset-delete',
  allOptions: 'phone-export-all-options',
  batchToggle: 'phone-export-batch-toggle',
  batch: 'phone-export-batch',
  batchSource: 'phone-export-batch-source',
  batchJob: 'phone-export-batch-job',
  batchJobSave: 'phone-export-batch-job-save',
  batchJobRemove: 'phone-export-batch-job-remove',
  batchRun: 'phone-export-batch-run',
  batchRetry: 'phone-export-batch-retry',
  batchCancel: 'phone-export-batch-cancel',
  batchClear: 'phone-export-batch-clear',
} as const;

export function phoneExportFormatTestId(id: PhoneExportFormatId): string {
  return `phone-export-format-${id}`;
}

/** Option chips: phone-export-<group>-<value>, e.g. phone-export-resolution-720, phone-export-range-selection. */
export function phoneExportOptionTestId(group: 'resolution' | 'fps' | 'quality' | 'rate' | 'range' | 'image' | 'prores' | 'preset', value: string | number): string {
  return `phone-export-${group}-${value}`;
}
