/** Give React and the canvas presenter one visible frame between agent edits. */
export async function yieldEditorPresentationFrame(): Promise<void> {
  if (typeof document === 'undefined' || document.hidden || typeof requestAnimationFrame !== 'function') {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    return;
  }
  await new Promise<void>(resolve => {
    let frame = 0;
    const fallback = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 100);
    frame = requestAnimationFrame(() => {
      clearTimeout(fallback);
      // A task after RAF lets the browser present the committed frame first.
      setTimeout(resolve, 0);
    });
  });
}
