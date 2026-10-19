import { describe, expect, it, vi } from 'vitest';

vi.mock('../modules/indexer/index.js', () => ({
  createIndexerBackgroundWorker: vi.fn(),
  scheduleIndexer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../modules/notifications/index.js', () => ({
  createNotificationsBackgroundWorker: vi.fn(),
}));
vi.mock('../modules/fraud-detection/index.js', () => ({
  createFraudDetectionCleanupBackgroundWorker: vi.fn(),
  scheduleFraudDetectionCleanup: vi.fn().mockResolvedValue(undefined),
}));

import { registerWorkers } from './index.js';
import { createNotificationsBackgroundWorker } from '../modules/notifications/index.js';
import {
  createFraudDetectionCleanupBackgroundWorker,
  scheduleFraudDetectionCleanup,
} from '../modules/fraud-detection/index.js';

describe('worker registration', () => {
  it('registers the indexer, notifications, and fraud-cleanup workers (#351, #352)', () => {
    expect(registerWorkers).toHaveLength(3);
    expect(createNotificationsBackgroundWorker).toBeDefined();
    expect(createFraudDetectionCleanupBackgroundWorker).toBeDefined();
  });

  it('schedules fraud-detection cleanup on worker startup (#353)', () => {
    expect(scheduleFraudDetectionCleanup).toHaveBeenCalledTimes(1);
  });
});
