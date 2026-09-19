import type {
  ProductAnalyticsEditAction,
  ProductAnalyticsEditOperation,
  ProductAnalyticsEditOrigin,
  ProductAnalyticsEditTarget,
} from './catalog';

export interface TimelineEditClassification {
  action: ProductAnalyticsEditAction;
  operation: ProductAnalyticsEditOperation;
  origin: ProductAnalyticsEditOrigin;
  target: ProductAnalyticsEditTarget;
}

function inferAction(label: string): ProductAnalyticsEditAction {
  if (/ripple delete/.test(label)) return 'ripple_delete';
  if (/ripple trim/.test(label)) return 'ripple_trim';
  if (/rolling edit/.test(label)) return 'roll';
  if (/rate stretch|audio speed|playback speed|change speed/.test(label)) return 'retime';
  if (/\bslip\b/.test(label)) return 'slip';
  if (/\bslide\b/.test(label)) return 'slide';
  if (/\bunbake\b/.test(label)) return 'unbake';
  if (/\bbake\b/.test(label)) return 'bake';
  if (/\bdisconnect\b/.test(label)) return 'disconnect';
  if (/\bconnect\b|rewire/.test(label)) return 'connect';
  if (/\bunlink\b/.test(label)) return 'unlink';
  if (/\blink\b/.test(label)) return 'link';
  if (/\bsync\b/.test(label)) return 'sync';
  if (/\bextract\b/.test(label)) return 'extract';
  if (/\blift\b/.test(label)) return 'lift';
  if (/\bresize\b|duration/.test(label)) return 'resize';
  if (/\bsplit\b/.test(label)) return 'split';
  if (/\bcut\b/.test(label)) return 'cut';
  if (/\btrim\b/.test(label)) return 'trim';
  if (/\bduplicate\b/.test(label)) return 'duplicate';
  if (/\bpaste\b/.test(label)) return 'paste';
  if (/\brename\b/.test(label)) return 'rename';
  if (/\breorder\b/.test(label)) return 'reorder';
  if (/\breplace\b/.test(label)) return 'replace';
  if (/\brestore\b/.test(label)) return 'restore';
  if (/\brotate\b/.test(label)) return 'rotate';
  if (/\bnudge\b/.test(label)) return 'nudge';
  if (/\bmove\b|position overwrite/.test(label)) return 'move';
  if (/\bsoften\b/.test(label)) return 'soften';
  if (/\bbypass\b/.test(label)) return 'bypass';
  if (/\bdisable\b/.test(label)) return 'disable';
  if (/\benable\b/.test(label)) return 'enable';
  if (/\breset\b/.test(label)) return 'reset';
  if (/\btoggle\b|cycle /.test(label)) return 'toggle';
  if (/\bclear\b/.test(label)) return 'clear';
  if (/\bremove\b/.test(label)) return 'remove';
  if (/\bdelete\b/.test(label)) return 'delete';
  if (/\bupgrade\b/.test(label)) return 'upgrade';
  if (/\bfit\b/.test(label)) return 'fit';
  if (/\bmark\b/.test(label)) return 'mark';
  if (/\buse\b/.test(label)) return 'use';
  if (/\bset\b/.test(label)) return 'set';
  if (/\banimate\b/.test(label)) return 'animate';
  if (/\bapply\b|drop transition/.test(label)) return 'apply';
  if (/\badjust\b|setting/.test(label)) return 'adjust';
  if (/\bupdate\b|change /.test(label)) return 'update';
  if (/\bedit\b/.test(label)) return 'edit';
  if (/\bcreate\b/.test(label)) return 'create';
  if (/\badd\b|insert/.test(label)) return 'add';
  if (/\bgroup\b/.test(label)) return 'group';
  return 'other';
}

function inferTarget(label: string): ProductAnalyticsEditTarget {
  if (/spectral image layer/.test(label)) return 'spectral_layer';
  if (/motion path|motion template/.test(label)) return 'motion_path';
  if (/keyframe|bezier handle/.test(label)) return 'keyframe';
  if (/transition/.test(label)) return 'transition';
  if (/mask/.test(label)) return 'mask';
  if (/node|ports?/.test(label)) return 'node';
  if (/midi|tempo|\bnote\b|music/.test(label)) return 'midi';
  if (/storyboard|\bscene\b/.test(label)) return 'scene';
  if (/caption|subtitle/.test(label)) return 'caption';
  if (/transcript/.test(label)) return 'transcript';
  if (/3d text|\btext\b|title/.test(label)) return 'text';
  if (/audio effect|\beffect\b|particle disintegrate/.test(label)) return 'effect';
  if (/\bstem\b/.test(label)) return 'stem';
  if (/audio|transient|silence|room tone/.test(label)) return 'audio';
  if (/color|grade|blend mode/.test(label)) return 'color';
  if (/camera/.test(label)) return 'camera';
  if (/transform|position|scale|rotation/.test(label)) return 'transform';
  if (/material/.test(label)) return 'material';
  if (/gaussian splat|splat effector/.test(label)) return 'model';
  if (/blendshape|3d model/.test(label)) return 'model';
  if (/\blight\b/.test(label)) return 'light';
  if (/fade/.test(label)) return 'fade';
  if (/adjustment layer|adjustment opacity/.test(label)) return 'adjustment';
  if (/\bclip/.test(label) || /range|playhead/.test(label)) return 'clip';
  if (/\btrack\b/.test(label)) return 'track';
  if (/composition/.test(label)) return 'composition';
  if (/dock/.test(label)) return 'dock';
  if (/panel/.test(label)) return 'panel';
  if (/hook/.test(label)) return 'hook';
  if (/project/.test(label)) return 'project';
  if (/media/.test(label)) return 'media';
  return 'other';
}

function inferOperation(label: string, target: ProductAnalyticsEditTarget): ProductAnalyticsEditOperation {
  if (target === 'scene') return 'storyboard';
  if (target === 'midi') return 'music';
  if (target === 'audio' || target === 'stem' || target === 'spectral_layer') return 'audio';
  if (target === 'keyframe' || target === 'camera' || target === 'motion_path') return 'animation';
  if (target === 'caption' || target === 'text' || target === 'transcript') return 'text';
  if (target === 'effect' || target === 'color' || target === 'mask' || target === 'adjustment'
    || target === 'light' || target === 'material' || target === 'model' || target === 'transform') return 'visual';
  if (target === 'dock' || target === 'panel' || target === 'node') return 'organize';
  if (/trim|split|cut|blade|ripple|rolling|extract|lift/.test(label)) return 'trim';
  if (/move|slip|slide|speed|duration|position|resize/.test(label)) return 'timing';
  if (/delete|remove|clear|disable/.test(label)) return 'delete';
  if (/add|insert|paste|create|duplicate|record|apply|drop/.test(label)) return 'add';
  if (/link|unlink|group|sync|reorder|connect/.test(label)) return 'organize';
  return 'other';
}

export function classifyTimelineEdit(label: string): TimelineEditClassification | null {
  const normalized = label.trim().toLowerCase();
  if (!normalized || normalized === 'initial') return null;
  if (/^tutorial:|tutorial sandbox|stress test fixture|preview transition|begin .*transaction|update .*transaction|cancel /.test(normalized)) {
    return null;
  }

  const origin: ProductAnalyticsEditOrigin = normalized.startsWith('ai:')
    || normalized === 'apply motion template'
    ? 'agent'
    : 'user';
  const semanticLabel = normalized.replace(/^ai:\s*/, '');
  const target = inferTarget(semanticLabel);
  return {
    action: inferAction(semanticLabel),
    operation: inferOperation(semanticLabel, target),
    origin,
    target,
  };
}
