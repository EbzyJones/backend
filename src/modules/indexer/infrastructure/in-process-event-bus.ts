import { publishBlockchainEvent } from '../../../shared/events/index.js';
import type { EventPublisher } from '../domain/index.js';

export function createInProcessEventBus(): EventPublisher {
  return {
    publish(event) {
      // The bus resolves once every subscriber has completed (bounded
      // concurrency) — the poll loop awaits this before checkpointing.
      return publishBlockchainEvent(event);
    },
  };
}
