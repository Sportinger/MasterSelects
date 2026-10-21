// The inspector and tool results state blur limits at the composition size; the frame actually
// rendered can differ (reduced-quality preview, nested composition, 3D layer-space effects at
// their source size). Logs once per effect and rendered size where the kernel is spread or capped.
import { Logger } from '../../services/logger';
import { blurBudgetNotes } from './blurSampling';

const log = Logger.create('BlurBudget');
const BLUR_TYPES = new Set(['gaussian-blur', 'box-blur', 'motion-blur', 'radial-blur', 'zoom-blur']);
const reported = new Set<string>();

export function reportBlurBudget(effect: { id: string; type: string; params: Record<string, unknown> }, width: number, height: number): void {
  if (!BLUR_TYPES.has(effect.type)) return;
  const key = `${effect.id}:${width}x${height}`;
  if (reported.has(key)) return;
  const notes = blurBudgetNotes(effect.type, effect.params, width, height);
  if (!notes.length) return;
  if (reported.size > 256) reported.clear();
  reported.add(key);
  log.warn(`${effect.type} (${effect.id}) rendered at ${width}×${height}: ${notes.join(' ')}`);
}
