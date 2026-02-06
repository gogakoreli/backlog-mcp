export type { BacklogEvent, BacklogEventType, BacklogEventCallback, EventBus } from './event-bus.js';
export { LocalEventBus } from './local-event-bus.js';

import { LocalEventBus } from './local-event-bus.js';

/** Singleton event bus instance. Swap implementation for cloud deployment. */
export const eventBus = new LocalEventBus();
