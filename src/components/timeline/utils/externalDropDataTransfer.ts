import { planTimelineExternalDropCommand } from '../../../timeline';

export function extractExternalDropFilePath(dataTransfer: DataTransfer): string | undefined {
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const uri = uriList.split('\n')[0]?.trim();
    if (uri?.startsWith('file://')) {
      return decodeURIComponent(uri.replace('file://', ''));
    }
  }

  const plainText = dataTransfer.getData('text/plain');
  if (plainText?.startsWith('/') || plainText?.startsWith('file://')) {
    return plainText.startsWith('file://')
      ? decodeURIComponent(plainText.replace('file://', ''))
      : plainText;
  }

  const mozUrl = dataTransfer.getData('text/x-moz-url');
  if (mozUrl?.startsWith('file://')) {
    return decodeURIComponent(mozUrl.split('\n')[0].replace('file://', ''));
  }

  return undefined;
}

export function planExternalDropCommand(dataTransfer: DataTransfer) {
  return planTimelineExternalDropCommand({
    types: Array.from(dataTransfer.types),
    fileCount: dataTransfer.files.length,
    getData: (mimeType) => dataTransfer.getData(mimeType),
  });
}
