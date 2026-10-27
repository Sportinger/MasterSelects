import type { PhoneSheetComponent } from '../contracts';
import { PhonePendingSheet } from '../sheets/PhonePendingSheet';

export const PhoneCompositionsSheet: PhoneSheetComponent = () => <PhonePendingSheet title="Compositions" />;
