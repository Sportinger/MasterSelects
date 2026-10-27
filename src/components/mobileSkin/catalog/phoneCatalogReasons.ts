// Greyed phone controls that catalog ids point at. Each reason repeats (the start of) the text the
// control shows on tap, so the coverage table stays readable without opening the sheet.

import { greyed, type PhoneCatalogTarget } from './phoneCatalogTargets';

export const GREYED_RANGE_EDITS: PhoneCatalogTarget = greyed(
  'Lift and extract an in/out range arrive with the range tools; until then use Split and Delete + close gap.',
  'edits', 'phone-edits-range');
export const GREYED_AUDIO_SYNC: PhoneCatalogTarget = greyed(
  'Lining clips up by their sound is not on the phone yet.', 'edits', 'phone-edits-audio-sync');
export const GREYED_RULER_LANES: PhoneCatalogTarget = greyed(
  'Ruler lanes, MIDI-triggered markers and timeline annotations are not on the phone yet.', 'markers', 'phone-markers-lanes');
export const GREYED_SPECTRAL: PhoneCatalogTarget = greyed(
  'Painting in the spectrogram needs the timeline\'s spectral view with a precise pointer; the phone has no spectral view.',
  'audioFx', 'phone-audiofx-unavailable-spectral');
export const GREYED_PREVIEW_WORD_EDIT: PhoneCatalogTarget = greyed(
  'Double-clicking a caption word in the picture is a feature of the desktop preview; the phone preview has no word editor.',
  'captions', 'phone-captions-unavailable-preview-edit');
export const GREYED_SHORTCUTS: PhoneCatalogTarget = greyed(
  'Keyboard shortcuts need a keyboard. Set them in the full editor on a computer.', 'settings', 'phone-settings-shortcuts');
export const GREYED_TOURS: PhoneCatalogTarget = greyed(
  'The guided tours point at the full editor’s controls. Open the Guide, or take the tour in the full editor.',
  'settings', 'phone-settings-tutorials');
export const GREYED_NATIVE_HELPER: PhoneCatalogTarget = greyed(
  'The native helper (fast decoding, web downloads with yt-dlp, MatAnyone2, MuScriptor) is a desktop program with Python and local models.',
  'settings', 'phone-settings-desktop-category', '[data-category="nativeHelper"]');
export const GREYED_EXTERNAL_DISPLAY: PhoneCatalogTarget = greyed(
  'A phone browser cannot address a second screen on its own: casting or a cable only mirrors this screen.',
  'settings', 'phone-settings-external-display');
export const GREYED_OPTIX: PhoneCatalogTarget = greyed(
  'The native OptiX renderer runs as a local CUDA/OptiX process with NVIDIA drivers, which a phone browser cannot run.',
  'settings', 'phone-settings-optix');
export const GREYED_LOCAL_MODELS: PhoneCatalogTarget = greyed(
  'MatAnyone2, MuScriptor and the other local models run in the desktop native helper with Python.',
  'settings', 'phone-settings-local-models');
export const GREYED_URL_DOWNLOAD: PhoneCatalogTarget = greyed(
  'Downloading from a web address needs yt-dlp and the native helper, desktop programs a phone browser cannot run.',
  'library', 'phone-library-web-download');
export const GREYED_HELPER_DOWNLOADS: PhoneCatalogTarget = greyed(
  'The download queue of the full editor runs through the native helper, a desktop program.',
  'library', 'phone-library-web-helper-downloads');
export const GREYED_SHOW_IN_FILES: PhoneCatalogTarget = greyed(
  'A phone browser only gets the files you pick, not their place on the phone, and it cannot open the file manager.',
  'library', 'phone-library-show-in-files');
