import { describe, expect, it, vi } from 'vitest';
import { createAssessActorUseCase } from './assess-actor.js';
import { createFixedClock, createInMemoryActorActivityRepository } from './__fixtures__/fakes.js';

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

    const result = await assessActor({ address: 'GSCAMMER' });

    const signal = result.signals.find((s) => s.ruleType === 'DISPUTE_RAISE_VELOCITY');
    expect(signal).toMatchObject({ count: 4, threshold: 3, windowHours: 24, triggered: true });
    expect(result.flagged).toBe(true);
  });

  describe('alerting', () => {
    it('dispatches an actor_flagged alert with the triggered signals when an actor is flagged', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      for (let i = 0; i < 11; i += 1) {
        activityRepository.seed('GBOTALERT', 'DELIVERY_CREATED', new Date());
      }
      const alertPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
      const assessActor = createAssessActorUseCase({ activityRepository, alertPublisher });

      const result = await assessActor({ address: 'GBOTALERT' });

      expect(result.flagged).toBe(true);
      expect(alertPublisher.publish).toHaveBeenCalledTimes(1);
      const event = alertPublisher.publish.mock.calls[0][0];
      expect(event).toMatchObject({ type: 'actor_flagged', address: 'GBOTALERT' });
      expect(event.signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleType: 'DELIVERY_CREATION_VELOCITY', triggered: true }),
        ]),
      );
      expect(event.signals.every((s: { triggered: boolean }) => s.triggered)).toBe(true);
    });

    it('does not dispatch an alert when the actor is not flagged', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      const alertPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
      const assessActor = createAssessActorUseCase({ activityRepository, alertPublisher });

      const result = await assessActor({ address: 'GCLEAN' });

      expect(result.flagged).toBe(false);
      expect(alertPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('under simulated indexer lag', () => {
    it('with an injected fixed clock, activity just inside the window relative to that clock is counted even when wall-clock time has moved on', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      // The indexer is 3 hours behind: this activity's on-chain occurredAt
      // is only 30 minutes before the *ledger* clock, even though real
      // wall-clock "now" (not used here) is much later.
      const laggedLedgerNow = new Date('2026-01-01T12:00:00Z');
      const occurredAt = new Date('2026-01-01T11:30:00Z');
      for (let i = 0; i < 11; i += 1) {
        activityRepository.seed('GLAGGED', 'DELIVERY_CREATED', occurredAt);
      }
      const assessActor = createAssessActorUseCase({
        activityRepository,
        clock: createFixedClock(laggedLedgerNow),
      });

      const result = await assessActor({ address: 'GLAGGED' });

      const signal = result.signals.find((s) => s.ruleType === 'DELIVERY_CREATION_VELOCITY');
      expect(signal).toMatchObject({ count: 11, triggered: true });
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
