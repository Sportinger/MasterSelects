export interface FlashBoardChatImageData {
  base64: string;
  dataUrl: string;
  mediaType: string;
}

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([a-z0-9+/=\s]+)$/i;

export function findFlashBoardChatImageData(value: unknown): FlashBoardChatImageData | null {
  if (typeof value === 'string') {
    const match = value.match(IMAGE_DATA_URL);
    return match ? { base64: match[2], dataUrl: value, mediaType: match[1].toLowerCase() } : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = findFlashBoardChatImageData(item);
      if (image) return image;
    }
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const image = findFlashBoardChatImageData(item);
      if (image) return image;
    }
  }
  return null;
}

export function redactFlashBoardChatImageData<T>(value: T): T {
  if (typeof value === 'string') {
    return (IMAGE_DATA_URL.test(value) ? '[image omitted from chat history]' : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(redactFlashBoardChatImageData) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, redactFlashBoardChatImageData(item)]),
    ) as T;
  }
  return value;
}
