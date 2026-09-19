export function hasDraggedLandingFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes('Files');
}

export function resizeLandingChatInput(
  textarea: HTMLTextAreaElement,
  maximumHeight: number,
): void {
  textarea.style.height = 'auto';
  const nextHeight = Math.min(textarea.scrollHeight, maximumHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? 'auto' : 'hidden';
}
