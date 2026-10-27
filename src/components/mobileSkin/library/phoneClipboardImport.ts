// Paste into the Library: images and files from the clipboard are imported like picked files, a pasted
// web link opens Web sources with it, other text is named but changes nothing. Two ways in: the Paste
// button reads the system clipboard (navigator.clipboard.read, the same reader the desktop Media panel
// uses), and a paste gesture (long-press > Paste, or Ctrl/Cmd+V) hands its own files and text, which
// also works where the browser refuses clipboard reading.
import { readSystemClipboard } from '../../panels/media/panel/mediaPanelClipboard';
import { parsePhoneWebUrl } from './phoneWebSearch';

export type PhoneClipboardContent =
  | { kind: 'files'; files: File[] }
  | { kind: 'link'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  | { kind: 'denied'; message: string };

export const PHONE_CLIPBOARD_DENIED =
  'This browser did not let MasterSelects read the clipboard. Long-press the Library list and choose Paste, or allow clipboard access for this site.';

/** Text that is only one web address becomes a link; prose stays text. */
export function classifyPhoneClipboardText(text: string): PhoneClipboardContent {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'empty' };
  if (!/\s/.test(trimmed)) {
    const url = parsePhoneWebUrl(trimmed);
    if (url) return { kind: 'link', url };
  }
  return { kind: 'text', text: trimmed };
}

/** Files win over text (a copied image often carries its file name as text too). */
export function classifyPhoneClipboard(files: readonly File[], text: string): PhoneClipboardContent {
  const usable = files.filter((file) => file.size > 0);
  if (usable.length > 0) return { kind: 'files', files: [...usable] };
  return classifyPhoneClipboardText(text);
}

/** Reads the system clipboard after a tap on Paste. Never throws. */
export async function readPhoneClipboard(): Promise<PhoneClipboardContent> {
  try {
    if (typeof navigator.clipboard?.read === 'function') {
      const content = await readSystemClipboard();
      return classifyPhoneClipboard(content.imageFiles, content.text);
    }
    if (typeof navigator.clipboard?.readText === 'function') return classifyPhoneClipboardText(await navigator.clipboard.readText());
    return { kind: 'denied', message: PHONE_CLIPBOARD_DENIED };
  } catch {
    return { kind: 'denied', message: PHONE_CLIPBOARD_DENIED };
  }
}

/** Content of a paste event (its DataTransfer needs no permission). */
export function readPhonePasteEvent(data: DataTransfer | null): PhoneClipboardContent {
  if (!data) return { kind: 'empty' };
  return classifyPhoneClipboard([...data.files], data.getData('text/plain'));
}
