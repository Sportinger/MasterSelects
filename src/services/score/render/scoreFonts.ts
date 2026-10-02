// VexFlow music-font availability for popup documents (issue #366).
//
// Importing 'vexflow' registers its bundled fonts (Bravura, Academico, …) as
// constructed FontFace objects on the MAIN document's FontFaceSet. The score
// editor renders into a detached popup, which is a different Document with
// its own FontFaceSet — without these faces its SVG <text> glyphs fall back
// to a non-music font and the notation renders as tofu boxes. Since the popup
// shares the JS realm, the same FontFace objects can simply be added to the
// popup document's set.

import { VexFlow } from 'vexflow';
import { Logger } from '../../logger';

const log = Logger.create('ScoreFonts');

/** Families the bundled 'vexflow' entry registers on the main document. */
const VEXFLOW_FONT_FAMILIES = new Set([
  'Bravura',
  'Academico',
  'Gonville',
  'Petaluma',
  'Petaluma Script',
]);

function normalizeFamily(family: string): string {
  return family.replace(/^["']|["']$/g, '');
}

/**
 * Make VexFlow's music fonts available in `doc` and wait until they are
 * loaded, so the first render doesn't measure/draw with a fallback font.
 */
export async function ensureScoreFontsInDocument(doc: Document): Promise<void> {
  // Touch VexFlow so the module (and its font registration) is initialized
  void VexFlow.BUILD;

  if (doc !== document) {
    document.fonts.forEach((face) => {
      if (!VEXFLOW_FONT_FAMILIES.has(normalizeFamily(face.family))) return;
      try {
        doc.fonts.add(face);
      } catch (error) {
        // CSS-connected faces can't be re-added; constructed VexFlow faces can
        log.debug('Could not share font face with popup', {
          family: face.family,
          error: String(error),
        });
      }
    });
  }

  try {
    await doc.fonts.ready;
  } catch (error) {
    log.warn('Font readiness wait failed; rendering may briefly use fallback glyphs', {
      error: String(error),
    });
  }
}
