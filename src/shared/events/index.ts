export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  occurredAt: Date;
}

export interface ActorFlaggedPayload {
  address: string;
  signals: string[];
}

export type ActorFlaggedEvent = DomainEvent<'actor_flagged', ActorFlaggedPayload>;

export function createActorFlaggedEvent(payload: ActorFlaggedPayload): ActorFlaggedEvent {
  return {
    type: 'actor_flagged',
    payload,
    occurredAt: new Date(),
  };
}
