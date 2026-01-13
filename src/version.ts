// App version - INCREMENT ON EVERY COMMIT!
// Format: MAJOR.MINOR.PATCH
// Increment PATCH (0.0.X) for each commit
export const APP_VERSION = '1.0.7';

// Changelog entry type
export interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    type: 'new' | 'fix' | 'improve';
    description: string;
  }[];
}

// Version changelog - add new entries at the TOP
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.7',
    date: '2026-01-13',
    changes: [
      { type: 'new', description: 'Native Helper app for hardware-accelerated video codecs' },
      { type: 'fix', description: 'Frame-accurate seeking for FFmpeg export' },
      { type: 'new', description: 'Audio support in FFmpeg export with progress bar' },
      { type: 'new', description: 'Custom FFmpeg WASM build with professional codecs' },
    ],
  },
  {
    version: '1.0.6',
    date: '2026-01-10',
    changes: [
      { type: 'improve', description: 'YouTubePanel component updates' },
      { type: 'new', description: 'Feature documentation system' },
    ],
  },
];

// Known issues and bugs - shown in What's New dialog
// Remove items when fixed
export const KNOWN_ISSUES: string[] = [
  'ProRes export requires Native Helper app (not yet released)',
  'Audio waveforms may not display for some video formats',
  'Very long videos (>2 hours) may cause performance issues',
];
