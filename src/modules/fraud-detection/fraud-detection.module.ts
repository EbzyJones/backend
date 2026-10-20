import { createAssessActorUseCase } from './application/assess-actor';
import { createFraudDetectionRouter } from './infrastructure/fraud-detection.router';
import { PrismaActorActivityRepository } from './infrastructure/prisma-actor-activity-repository';
import type { ActorActivityRepository } from './domain/ports';
import type { EventBus } from '../../../shared/events';
import type { NotificationPort } from '../../notifications/domain/ports';

export interface FraudDetectionModuleDeps {
  actorActivityRepository?: ActorActivityRepository;
  eventBus?: EventBus;
  notifications?: NotificationPort;
}

export function createFraudDetectionModule(deps: FraudDetectionModuleDeps = {}) {
  const actorActivityRepository =
    deps.actorActivityRepository ?? new PrismaActorActivityRepository();

  const assessActor = createAssessActorUseCase({
    actorActivityRepository,
    eventBus: deps.eventBus,
    notifications: deps.notifications,
  });

  const router = createFraudDetectionRouter({ assessActor });

  return {
    assessActor,
    router,
  };
}
