import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

import { HEARTBEAT_FAILURE_FATAL_THRESHOLD, createHeartbeatController } from './heartbeat.js';
import { workerHeartbeatFailuresTotal } from '../shared/metrics/index.js';

async function metricValue(): Promise<number> {
  const metric = await workerHeartbeatFailuresTotal.get();
  return metric.values[0]?.value ?? 0;
}

describe('worker heartbeat controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('writes the marker file and reports success', async () => {
    const onFatalFailure = vi.fn();
    const heartbeat = createHeartbeatController(onFatalFailure);

    await expect(heartbeat.write()).resolves.toBe(true);

    expect(mkdirMock).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('worker.heartbeat'),
      expect.any(String),
    );
    expect(heartbeat.consecutiveFailures()).toBe(0);
    expect(onFatalFailure).not.toHaveBeenCalled();
  });

  it('increments worker_heartbeat_failures_total when the write fails (issue #357)', async () => {
    const onFatalFailure = vi.fn();
    const heartbeat = createHeartbeatController(onFatalFailure);
    const before = await metricValue();
    writeFileMock.mockRejectedValueOnce(new Error('EROFS: read-only file system'));

    await expect(heartbeat.write()).resolves.toBe(false);

    expect(await metricValue()).toBe(before + 1);
    expect(heartbeat.consecutiveFailures()).toBe(1);
    // One isolated failure (e.g. a transient EBUSY) must not kill the worker.
    expect(onFatalFailure).not.toHaveBeenCalled();
  });

  it('treats a failed mkdir the same as a failed writeFile', async () => {
    const onFatalFailure = vi.fn();
    const heartbeat = createHeartbeatController(onFatalFailure);
    const before = await metricValue();
    mkdirMock.mockRejectedValueOnce(new Error('EACCES: permission denied'));

    await expect(heartbeat.write()).resolves.toBe(false);

    expect(await metricValue()).toBe(before + 1);
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(heartbeat.consecutiveFailures()).toBe(1);
  });

  it('resets the consecutive failure count after a successful write', async () => {
    const onFatalFailure = vi.fn();
    const heartbeat = createHeartbeatController(onFatalFailure);
    writeFileMock.mockRejectedValueOnce(new Error('disk full'));

    await heartbeat.write();
    expect(heartbeat.consecutiveFailures()).toBe(1);

    await expect(heartbeat.write()).resolves.toBe(true);
    expect(heartbeat.consecutiveFailures()).toBe(0);
  });

  it(`triggers graceful shutdown after ${HEARTBEAT_FAILURE_FATAL_THRESHOLD} consecutive failures (issue #357)`, async () => {
    const onFatalFailure = vi.fn();
    const heartbeat = createHeartbeatController(onFatalFailure);
    const before = await metricValue();
    writeFileMock.mockRejectedValue(new Error('EROFS: read-only file system'));

    for (let i = 0; i < HEARTBEAT_FAILURE_FATAL_THRESHOLD - 1; i += 1) {
      await heartbeat.write();
    }
    expect(onFatalFailure).not.toHaveBeenCalled();

    await heartbeat.write();

    expect(onFatalFailure).toHaveBeenCalledTimes(1);
    expect(heartbeat.consecutiveFailures()).toBe(HEARTBEAT_FAILURE_FATAL_THRESHOLD);
    expect(await metricValue()).toBe(before + HEARTBEAT_FAILURE_FATAL_THRESHOLD);
  });
});
