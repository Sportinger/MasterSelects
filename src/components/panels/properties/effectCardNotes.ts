import { getEffect } from '../../../effects';
import { effectDefinitionNotes } from '../../../services/operators/effectParamVisibility';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';

/**
 * The effect's own notes on values it clamps, ignores or cannot show (`paramWarnings`, judged on
 * the instance's recipe: an earlier saved stylize recipe gets none). Tool results name parameters
 * by id ("levels: 1 is …"); the inspector names them by their label.
 */
export function definitionNotes(effectType: string, params: Record<string, unknown>, operatorGraph: EffectOperatorGraph | undefined,
  width: number, height: number): string[] {
  const definition = getEffect(effectType);
  if (!definition) return [];
  const labelled = (note: string) => note.replace(/^([A-Za-z][\w-]*): /, (prefix, id: string) => {
    const label = Object.hasOwn(definition.params, id) ? definition.params[id].label : undefined;
    return label ? `${label}: ` : prefix;
  });
  return effectDefinitionNotes({ type: effectType, params, operatorGraph }, width, height).map(labelled);
}

/**
 * A lower Preview Quality draws the graphs on a smaller frame, where a pattern size can round
 * differently or reach its one-pixel floor: the notes that only hold for that preview frame, named as such.
 * (During playback a 4K composition may draw smaller still; the renderer logs that size.)
 */
export function previewSizeNotes(effectType: string, params: Record<string, unknown>, operatorGraph: EffectOperatorGraph | undefined,
  width: number, height: number, previewQuality: number, exported: readonly string[]): string[] {
  if (!(previewQuality > 0 && previewQuality < 1)) return [];
  const previewWidth = Math.round(width * previewQuality), previewHeight = Math.round(height * previewQuality);
  const shown = definitionNotes(effectType, params, operatorGraph, previewWidth, previewHeight)
    .filter(note => !exported.includes(note));
  return shown.length ? [`At this Preview Quality the preview draws ${previewWidth}×${previewHeight}, the export ${width}×${height}. In the preview: ${shown.join(' ')}`] : [];
}
