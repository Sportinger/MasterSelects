export { PropertyRegistry, propertyRegistry } from './PropertyRegistry';
export { registerCoreProperties } from './registerCoreProperties';
export * from './propertyAuthoring';

import { propertyRegistry } from './PropertyRegistry';
import { registerCoreProperties } from './registerCoreProperties';

registerCoreProperties(propertyRegistry);
