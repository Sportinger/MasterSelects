import type { PhoneSheetComponent } from '../contracts';
import { PhonePendingSheet } from '../sheets/PhonePendingSheet';

export const PhoneCropSheet: PhoneSheetComponent = () => <PhonePendingSheet title="Crop & transform" />;
