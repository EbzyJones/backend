import { afterEach, describe, expect, it, vi } from 'vitest';
import { poolAwareDatasourceUrl } from './prisma-client.js';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn(),
}));

import { getConfig } from '../config/index.js';

describe('poolAwareDatasourceUrl', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('uses `?` separator when the datasource URL has no existing query params', () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DATABASE_POOL_SIZE: 10,
      DATABASE_POOL_TIMEOUT: 10,
    } as any);

    const url = poolAwareDatasourceUrl();
    expect(url).toBe(
      'postgresql://user:pass@localhost:5432/db?connection_limit=10&pool_timeout=10',
    );
  });

  it('uses `&` separator when the datasource URL already has query params', () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      DATABASE_POOL_SIZE: 20,
      DATABASE_POOL_TIMEOUT: 15,
    } as any);

    const url = poolAwareDatasourceUrl();
    expect(url).toBe(
      'postgresql://user:pass@localhost:5432/db?schema=public&connection_limit=20&pool_timeout=15',
    );
  });

  it('defaults to pool size of at least 10 connections', () => {
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DATABASE_POOL_SIZE: 10,
      DATABASE_POOL_TIMEOUT: 10,
    } as any);

    const url = poolAwareDatasourceUrl();
    expect(url).toContain('connection_limit=10');
  });
});
