import {
  sourceVerificationPercent,
  type SourceVerificationStatus,
} from '../../../services/project/repository/artifacts/sourceVerificationStatus';

const gigabytes = (bytes: number) => `${(bytes / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;
const count = (value: number, one: string, many: string) => `${value.toLocaleString()} ${value === 1 ? one : many}`;

export interface ToolbarActivityLine { label: string; detail: string; percent?: number }

/** What is still loading or being checked, most user-visible first (an empty list hides the indicator). */
export function describeToolbarActivity(input: {
  connecting: boolean;
  decoders: number;
  thumbnails: number;
  verification: SourceVerificationStatus | null;
}): ToolbarActivityLine[] {
  const lines: ToolbarActivityLine[] = [];
  if (input.connecting) lines.push({ label: 'Connecting media…', detail: 'Opening the media files of this composition.' });
  if (input.decoders > 0) lines.push({ label: 'Loading media…', detail: `Starting playback for ${count(input.decoders, 'source', 'sources')}; the preview fills in when they are ready.` });
  if (input.thumbnails > 0) lines.push({ label: 'Building thumbnails…', detail: `Thumbnails for ${count(input.thumbnails, 'clip source', 'clip sources')}.` });
  if (input.verification) {
    const percent = sourceVerificationPercent(input.verification);
    lines.push({
      label: `Verifying media ${percent} %`,
      percent,
      detail: `Checking ${count(input.verification.files, 'original file', 'original files')} byte for byte `
        + `(${gigabytes(input.verification.bytesDone)} of ${gigabytes(input.verification.bytesTotal)}), once per file, `
        + 'so the project can later prove that its originals did not change.',
    });
  }
  return lines;
}

