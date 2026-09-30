import { trackEditorControlCommitted } from '../../../services/productAnalytics';

export function trackResolveControl(controlId: string, inputMethod: 'drag' | 'keyboard' | 'reset' | 'type') {
  trackEditorControlCommitted({
    area: 'color',
    controlId,
    controlKind: 'number',
    inputMethod,
    interaction: inputMethod === 'reset' ? 'reset' : 'change',
    itemId: controlId,
    itemKind: 'property',
  });
}
