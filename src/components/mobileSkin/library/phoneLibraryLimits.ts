// Accept list and greyed-out reasons of the phone Library.
/** File types the editor groups into model and splat sequences (utils/modelSequence, utils/gaussianSplatSequence). */
export const PHONE_SEQUENCE_ACCEPT = '.glb,.ply,.splat';

export const PHONE_LIBRARY_LIMITS = {
  proxyFolder: 'This browser cannot give the app a folder of your choice (no folder picker on phones). Proxies are kept in the project storage the browser manages for this site; they work the same and stay until you delete the project.',
} as const;

export const PHONE_SHOW_IN_FILES_REASON = 'A phone browser only gets the files you pick, not their place on the phone, and it cannot open the file manager. The name above tells you which file it is; Replace the source file picks a new one, and Export or Share saves results where you choose.';

/** Reading text in pictures: the editor has the OCR plumbing but no OCR engine yet, on any device. */
export const PHONE_OCR_REASON = 'OCR is not available yet: reading text in pictures needs a local OCR engine that MasterSelects does not ship yet, on the phone or in the full editor. It stays here, locked, until it does.';
