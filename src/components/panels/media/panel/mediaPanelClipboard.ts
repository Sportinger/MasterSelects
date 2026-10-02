// System clipboard access for Media panel paste/copy: pasted images, pasted
// video page links and plain-text copies.

import { parseDownloadUrls } from '../../../../services/mediaDiscovery/videoUrlDownloads';

export interface SystemClipboardContent {
  imageFiles: File[];
  text: string;
}

function getClipboardImageExtension(type: string): string {
  const subtype = type.split('/')[1]?.split('+')[0] || 'png';
  return subtype === 'jpeg' ? 'jpg' : subtype;
}

/** Reads images and plain text with one async-clipboard request. */
export async function readSystemClipboard(): Promise<SystemClipboardContent> {
  if (!navigator.clipboard?.read) return { imageFiles: [], text: '' };

  const clipboardItems = await navigator.clipboard.read();
  const imageFiles: File[] = [];
  let text = '';

  for (const item of clipboardItems) {
    for (const type of item.types) {
      if (type.startsWith('image/')) {
        const blob = await item.getType(type);
        const extension = getClipboardImageExtension(type);
        imageFiles.push(new File([blob], `clipboard-${Date.now()}.${extension}`, {
          type,
          lastModified: Date.now(),
        }));
      } else if (type === 'text/plain' && !text) {
        text = await (await item.getType(type)).text();
      }
    }
  }

  return { imageFiles, text };
}

/**
 * Returns the first link when the pasted text consists only of links, so
 * prose that merely contains a URL is not mistaken for a download request.
 */
export function findPastedDownloadUrl(text: string): string | null {
  const urls = parseDownloadUrls(text);
  if (urls.length === 0) return null;
  const remainder = text.replace(/https?:\/\/[^\s"'<>]+/gi, '').trim();
  return remainder.length === 0 ? urls[0] ?? null : null;
}

export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
