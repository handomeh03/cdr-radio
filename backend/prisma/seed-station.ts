import {
  BroadcastStatus,
  type PrismaClient,
} from '../src/generated/prisma/client.js';
import { MAIN_STATION_SLUG } from '../src/modules/stations/stations.constants.js';

/**
 * Creates the "main" station (OFF_AIR, no playlist) and its empty playback row if they are
 * missing. Strictly find-or-create: no UPDATE is ever issued, so re-running the seed cannot
 * overwrite settings an admin has changed (nor touch their timestamps).
 */
export async function seedStation(
  prisma: Pick<PrismaClient, 'station' | 'stationPlayback'>,
): Promise<'created' | 'existing'> {
  let station = await prisma.station.findUnique({
    where: { slug: MAIN_STATION_SLUG },
    select: { id: true },
  });
  const created = station === null;
  station ??= await prisma.station.create({
    data: {
      slug: MAIN_STATION_SLUG,
      name: 'CDR Central Radio',
      desiredStatus: BroadcastStatus.OFF_AIR,
    },
    select: { id: true },
  });

  const playback = await prisma.stationPlayback.findUnique({
    where: { stationId: station.id },
    select: { id: true },
  });
  if (!playback) {
    await prisma.stationPlayback.create({ data: { stationId: station.id } });
  }
  return created ? 'created' : 'existing';
}
