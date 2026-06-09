export function focusMediaBoardAnnotationText(root: ParentNode | null, annotationId: string): void {
  root
    ?.querySelector<HTMLTextAreaElement>(`[data-media-board-annotation-text="${annotationId}"]`)
    ?.focus();
}
