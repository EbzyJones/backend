import type { PrismaClient, ActorActivity, ActorActivityCategory } from '@prisma/client';
import type { ActorActivityRepository } from '../domain/ports';

export function createPrismaActorActivityRepository(
  prisma: PrismaClient,
): ActorActivityRepository {
  return {
    async record(activity: ActorActivity): Promise<ActorActivity> {
      return prisma.actorActivity.create({ data: activity });
    },

    async findByAddress(
      address: string,
      category?: ActorActivityCategory,
      since?: Date,
    ): Promise<ActorActivity[]> {
      return prisma.actorActivity.findMany({
        where: {
          address,
          ...(category ? { category } : {}),
          ...(since ? { occurredAt: { gte: since } } : {}),
        },
        orderBy: { occurredAt: 'desc' },
      });
    },

    async countSince(
      address: string,
      category: ActorActivityCategory,
      since: Date,
      limit?: number,
    ): Promise<number> {
      const where = { address, category, occurredAt: { gte: since } };

      if (limit === undefined) {
        return prisma.actorActivity.count({ where });
      }

      const rows = await prisma.actorActivity.findMany({
        where,
        take: limit,
        select: { id: true },
      });
      return rows.length;
    },

    async deleteOlderThan(cutoff: Date): Promise<number> {
      const result = await prisma.actorActivity.deleteMany({
        where: { occurredAt: { lt: cutoff } },
      });
      return result.count;
    },
  };
}
