import { describe, expect, it } from 'vitest';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { createWorkerSoftwareFeedbackStore } from '../../src/services/render/workerSoftwareFeedbackEffects';
import { workerSoftwareEffectPlanForLayer } from '../../src/services/render/workerSoftwareEffectPlan';
import { applyWorkerSoftwarePixelEffects } from '../../src/services/render/workerSoftwarePixelEffects';
import type { Effect } from '../../src/types';
import type { Layer } from '../../src/types/layers';

const effect = (): Effect => ({
  id: 'water', type: 'acuarela', name: 'Acuarela', enabled: true,
  params: { opacity: 1, strength: 0, gain: 0, speed: 0, detail: 0, density: 0, gainX: 0, gainY: 0 },
});

const layer = (water: Effect): Layer => ({
  id: 'water-layer', name: 'Water', visible: true, opacity: 1, blendMode: 'normal',
  source: { type: 'solid' }, position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
  effects: [water],
});

describe('worker software Acuarela image graph integration', () => {
  it('runs migrated graph history once and honors an edited feedback decay', () => {
    const canonical = migratePersistedEffectOperatorGraph(effect());
    const editedGraph = structuredClone(canonical.operatorGraph!);
    editedGraph.nodes.find(node => node.id === 'feedback-decay')!.constants = { value: .5 };
    const edited = { ...canonical, operatorGraph: editedGraph };
    const planned = workerSoftwareEffectPlanForLayer(layer(edited))!;
    expect(planned.pixelEffects.imageOperatorPlans).toHaveLength(1);
    expect(planned.pixelEffects.acuarelaAdjustments).toBeUndefined();

    const renderSequence = (water: Effect, changedSourceHold: boolean) => {
      const plan = workerSoftwareEffectPlanForLayer(layer(water))!;
      const store = createWorkerSoftwareFeedbackStore();
      const render = (rgba: readonly number[], time: number) => {
        const data = new Uint8ClampedArray(rgba), imageData = { data };
        const context = { getImageData: () => imageData, putImageData: () => undefined } as unknown as OffscreenCanvasRenderingContext2D;
        applyWorkerSoftwarePixelEffects(context, 1, 1, { pixelEffects: plan.pixelEffects } as never, time, store, 'preview', {
          timelineTimeSeconds: time, eventRevision: 0, compositionId: 'comp', ownerRevision: 1,
        });
        return [...data];
      };
      render([255, 255, 255, 255], 0);
      if (changedSourceHold) render([64, 32, 16, 128], 0);
      return render([0, 0, 0, 0], 1);
    };

    const editedAdvance = renderSequence(edited, false);
    const defaultAdvance = renderSequence(canonical, false);
    // Initial RGB is round(255 * .96) = 245; only the latest current
    // output advances to history, then contributes decay * .04 to RGB.
    expect(editedAdvance).toEqual([5, 5, 5, 128]);
    expect(defaultAdvance).toEqual([10, 10, 10, 250]);
    expect(renderSequence(edited, true)).toEqual([1, 1, 0, 64]);
  });

  it('keeps a legacy no-graph Acuarela on exactly the legacy feedback path', () => {
    const planned = workerSoftwareEffectPlanForLayer(layer(effect()))!;
    expect(planned.pixelEffects.imageOperatorPlans).toBeUndefined();
    expect(planned.pixelEffects.acuarelaAdjustments).toHaveLength(1);
  });
});
