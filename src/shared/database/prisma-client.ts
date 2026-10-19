import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config/index.js';

let client: PrismaClient | undefined;

/**
 * Appends Prisma connection-pool parameters (`connection_limit`,
 * `pool_timeout`) to the datasource URL so the pool is explicitly tuned
 * instead of relying on Prisma's default (`num_physical_cpus * 2 + 1`,
 * which is only 3 on a single-vCPU container and exhausts under burst
 * traffic). See docs/DEPLOYMENT.md § Database Connection Pooling.
 */
export function poolAwareDatasourceUrl(): string {
  const config = getConfig();
  const { DATABASE_URL, DATABASE_POOL_SIZE, DATABASE_POOL_TIMEOUT } = config;
  const separator = DATABASE_URL.includes('?') ? '&' : '?';
  return `${DATABASE_URL}${separator}connection_limit=${DATABASE_POOL_SIZE}&pool_timeout=${DATABASE_POOL_TIMEOUT}`;
}

/**
 * Single Prisma client for the process (both the API and worker processes
 * each get their own instance, per process — this is not shared across
 * processes). Prisma manages its own connection pool internally, so
 * repositories should import this rather than constructing their own client.
 */
export function getPrismaClient(): PrismaClient {
  client ??= new PrismaClient({
    datasources: {
      db: {
        url: poolAwareDatasourceUrl(),
      },
    },
    log: getConfig().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.$disconnect();
}
