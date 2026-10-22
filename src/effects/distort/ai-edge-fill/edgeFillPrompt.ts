export const LEGACY_EDGE_FILL_PROMPT = 'Fill the black empty borders of this photograph with a natural continuation of the room, walls, ceiling and floor. Match the perspective, lighting, colors and texture. Keep the existing photograph and its framing unchanged.';

/** What the fill should continue, in plain words: the only part of the request the card shows. */
export const DEFAULT_EDGE_FILL_SCENE = 'this room, walls, ceiling and floor';

/**
 * Typical scenes for the card's Scene menu: starting points for the scene text (the user can edit it).
 * Room is the default request, word for word as before.
 */
export const EDGE_FILL_SCENES: ReadonlyArray<{ id: string; label: string; scene: string }> = [
  { id: 'room', label: 'Room', scene: DEFAULT_EDGE_FILL_SCENE },
  { id: 'stage', label: 'Stage', scene: 'this theatre stage, its floor, black masking and lighting rig' },
  { id: 'street', label: 'Street', scene: 'this street, its buildings, pavement and sky' },
  { id: 'landscape', label: 'Landscape', scene: 'this landscape, its ground, horizon and sky' },
];

/**
 * The full request sent with the corrected photo and its mask: a fixed technical frame around the scene text,
 * so the user never has to edit (or can break) the mask sentences.
 */
export function edgeFillPrompt(scene: string): string {
  const words = scene.trim().replace(/[.\s]+$/, '') || DEFAULT_EDGE_FILL_SCENE;
  return `Image 1 is a photograph with missing pixels marked bright magenta. Image 2 is an edit mask: white marks ALL missing pixels, black marks the original photograph. Replace EVERY magenta area, including all four outer borders and corners, with a seamless natural continuation of ${words}. Extend existing lines, perspective, lighting, colors and textures exactly across the edges. Preserve the original black-mask photograph, its framing and placement. Output only the completed full-frame photograph at the same aspect ratio. No border, no letterbox, no black bars, no magenta, no mask, no crop, no zoom, no repositioning.`;
}

/** The full request of earlier versions' default Prompt (the default scene in the fixed frame). */
export const EDGE_FILL_PROMPT = edgeFillPrompt(DEFAULT_EDGE_FILL_SCENE);

/**
 * A full prompt written by hand in an earlier version (the old Prompt field held the whole request), or
 * undefined when the request comes from the scene text: an empty prompt, or one of the old defaults.
 */
export function customEdgeFillPrompt(params: Record<string, unknown>): string | undefined {
  const prompt = String(params.prompt ?? '').trim();
  return !prompt || prompt === EDGE_FILL_PROMPT || prompt === LEGACY_EDGE_FILL_PROMPT ? undefined : prompt;
}

/** The request generation sends: a saved custom full prompt as it was, otherwise the scene in the fixed frame. */
export function resolveEdgeFillPrompt(params: Record<string, unknown>): string {
  return customEdgeFillPrompt(params) ?? edgeFillPrompt(String(params.scene ?? DEFAULT_EDGE_FILL_SCENE));
}
