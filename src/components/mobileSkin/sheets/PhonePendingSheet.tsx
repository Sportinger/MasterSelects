// Placeholder frame for a sheet whose tools are still being built: it opens, explains itself and
// closes again without touching the project.
import { PhoneSheet } from './PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';

export function PhonePendingSheet({ title }: { title: string }) {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  return (
    <PhoneSheet title={title} height="half" onCancel={closeSheet} cancelLabel="Close">
      <p className="phone-sheet__note">{title} is being built for the phone. Until then, use the full editor.</p>
    </PhoneSheet>
  );
}
