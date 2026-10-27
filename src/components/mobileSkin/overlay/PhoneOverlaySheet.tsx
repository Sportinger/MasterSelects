import type { PhoneSheetComponent } from '../contracts';
import { PhonePendingSheet } from '../sheets/PhonePendingSheet';

export const PhoneOverlaySheet: PhoneSheetComponent = () => <PhonePendingSheet title="Overlay" />;
