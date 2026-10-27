import type { PhoneSheetComponent } from '../contracts';
import { PhonePendingSheet } from '../sheets/PhonePendingSheet';

export const PhoneMaskSheet: PhoneSheetComponent = () => <PhonePendingSheet title="Mask" />;
