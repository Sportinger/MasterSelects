import type { PhoneSheetComponent } from '../contracts';
import { PhonePendingSheet } from '../sheets/PhonePendingSheet';

export const PhoneEditsSheet: PhoneSheetComponent = () => <PhonePendingSheet title="Trim modes" />;
