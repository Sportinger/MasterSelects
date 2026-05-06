export { PropertyRegistry, propertyRegistry } from './PropertyRegistry';
export { registerCoreProperties } from './registerCoreProperties';

import { propertyRegistry } from './PropertyRegistry';
import { registerCoreProperties } from './registerCoreProperties';

registerCoreProperties(propertyRegistry);
