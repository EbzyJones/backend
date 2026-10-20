import { describe, it, expect, vi } from 'vitest';
import {
  createAssessActorUseCase,
  RULES,
  type RuleDefinition,
} from './assess-actor.js';
import type { FraudRepository } from '../domain/fraud-repository.js';
import type { FraudActivity } from '../domain/fraud-activity.js';

function makeActivity(overrides: Partial<FraudActivity> = {}): FraudActivity {
  return {
    id: 'activity-1',
    actorId: 'actor-1',
    type: 'DELIVERY_CREATION',
    occurredAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as FraudActivity;
}

function makeRepository(activities: FraudActivity[]): FraudRepository {
  return {
    listActivitiesByActor: vi.fn().mockResolvedValue(activities),
    recordAssessment: vi.fn().mockResolvedValue(undefined),
  } as unknown as FraudRepository;
}

describe('createAssessActorUseCase', () => {
  it('uses default RULES when no ruleDefinitions are provided', async () => {
    const activities = Array.from({ length: 10 }, (_, i) =>
      makeActivity({
        id: `activity-${i}`,
        occurredAt: new Date('2024-01-01T00:00:00.000Z'),
      }),
    );
    const repository = makeRepository(activities);
    const assessActor = createAssessActorUseCase({ repository });

    const result = await assessActor({ actorId: 'actor-1' });

    expect(result.flagged).toBe(true);
    expect(result.triggeredRules).toContain('DELIVERY_CREATION_VELOCITY');
  });

  it('does not flag an actor below the default threshold', async () => {
    const activities = Array.from({ length: 9 }, (_, i) =>
      makeActivity({ id: `activity-${i}` }),
    );
    const repository = makeRepository(activities);
    const assessActor = createAssessActorUseCase({ repository });

    const result = await assessActor({ actorId: 'actor-1' });

    expect(result.flagged).toBe(false);
  });

  it('flags an actor after 3 activities when a custom threshold of 2 is injected', async () => {
    const customRules: RuleDefinition[] = [
      {
        name: 'DELIVERY_CREATION_VELOCITY',
        activityType: 'DELIVERY_CREATION',
        windowHours: 1,
        threshold: 2,
      },
    ];
    const activities = Array.from({ length: 3 }, (_, i) =>
      makeActivity({
        id: `activity-${i}`,
        occurredAt: new Date('2024-01-01T00:00:00.000Z'),
      }),
    );
    const repository = makeRepository(activities);
    const assessActor = createAssessActorUseCase({
      repository,
      ruleDefinitions: customRules,
    });

    const result = await assessActor({ actorId: 'actor-1' });

    expect(result.flagged).toBe(true);
    expect(result.triggeredRules).toContain('DELIVERY_CREATION_VELOCITY');
  });

  it('does not flag an actor below a custom threshold', async () => {
    const customRules: RuleDefinition[] = [
      {
        name: 'DELIVERY_CREATION_VELOCITY',
        activityType: 'DELIVERY_CREATION',
        windowHours: 1,
        threshold: 2,
      },
    ];
    const activities = Array.from({ length: 2 }, (_, i) =>
      makeActivity({ id: `activity-${i}` }),
    );
    const repository = makeRepository(activities);
    const assessActor = createAssessActorUseCase({
      repository,
      ruleDefinitions: customRules,
    });

    const result = await assessActor({ actorId: 'actor-1' });

    expect(result.flagged).toBe(false);
  });

  it('exposes the default RULES with the documented thresholds', () => {
    const byName = Object.fromEntries(RULES.map((rule) => [rule.name, rule]));

    expect(byName.DELIVERY_CREATION_VELOCITY).toMatchObject({
      windowHours: 1,
      threshold: 10,
    });
    expect(byName.ESCROW_RELEASE_VELOCITY).toMatchObject({
      windowHours: 1,
      threshold: 10,
    });
    expect(byName.DISPUTE_RAISE_VELOCITY).toMatchObject({
      windowHours: 24,
      threshold: 3,
    });
  });
});
