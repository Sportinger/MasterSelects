import type { PhoneSheetComponent } from '../contracts';
import { PhonePendingSheet } from '../sheets/PhonePendingSheet';

export const PhoneTransitionSheet: PhoneSheetComponent = () => <PhonePendingSheet title="Transition" />;
