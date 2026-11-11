import type { Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * Advertisement state writes from publishing jobs. Satellite jobs (primary=false, e.g. the separate Google
 * Business Profile copy) never change the advertisement's state — the primary (Instagram) job owns it.
 * Returns a PrismaPromise so it can be used inside $transaction([...]).
 */
export function adWrite(primary: boolean, id: string, data: Prisma.AdvertisementUpdateInput) {
  return primary ? prisma.advertisement.update({ where: { id }, data }) : prisma.advertisement.findUnique({ where: { id }, select: { id: true } });
}
export function adWriteIf(primary: boolean, id: string, state: Prisma.AdvertisementWhereInput['state'], data: Prisma.AdvertisementUpdateManyMutationInput) {
  return primary ? prisma.advertisement.updateMany({ where: { id, state }, data }) : prisma.advertisement.count({ where: { id } });
}
