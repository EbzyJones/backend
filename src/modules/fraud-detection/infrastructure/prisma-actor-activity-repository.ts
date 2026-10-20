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

    async deleteOlderThan(cutoff: Date): Promise<number> {
      const result = await prisma.actorActivity.deleteMany({
        where: { occurredAt: { lt: cutoff } },
      });
      return result.count;
    },
  };
}
