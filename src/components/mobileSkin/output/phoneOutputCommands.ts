import { nextOutputTargetName, registerClosedOutputTarget } from '../../outputManager/outputTargetCommands';
import { usePhoneOutputStore } from './phoneOutputStore';

/** Adds an output target that is configured and saved on the phone; its window opens on a computer. */
export function addPhoneOutputTarget(): string {
  const id = `output_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  registerClosedOutputTarget(id, nextOutputTargetName());
  usePhoneOutputStore.getState().selectTarget(id);
  return id;
}

/** Why "Open on display" is greyed on the phone (shown on tap). */
export const PHONE_OUTPUT_EXTERNAL_DISPLAY_REASON =
  'Showing an output on a projector or second screen needs a separate output window on that display, which a phone browser cannot open. '
  + 'Build and save the mapping here; the full editor\'s Output Manager opens it on the display (Restore).';
