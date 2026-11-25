-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('ON_AIR', 'OFF_AIR');

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active_playlist_id" UUID,
    "desired_status" "BroadcastStatus" NOT NULL DEFAULT 'OFF_AIR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_playback" (
    "id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "current_track_id" UUID,
    "current_playlist_track_id" UUID,
    "started_at" TIMESTAMP(3),
    "start_offset_ms" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_playback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stations_slug_key" ON "stations"("slug");

-- CreateIndex
CREATE INDEX "stations_active_playlist_id_idx" ON "stations"("active_playlist_id");

-- CreateIndex
CREATE UNIQUE INDEX "station_playback_station_id_key" ON "station_playback"("station_id");

-- CreateIndex
CREATE INDEX "station_playback_current_track_id_idx" ON "station_playback"("current_track_id");

-- CreateIndex
CREATE INDEX "station_playback_current_playlist_track_id_idx" ON "station_playback"("current_playlist_track_id");

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_active_playlist_id_fkey" FOREIGN KEY ("active_playlist_id") REFERENCES "playlists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_playback" ADD CONSTRAINT "station_playback_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_playback" ADD CONSTRAINT "station_playback_current_track_id_fkey" FOREIGN KEY ("current_track_id") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_playback" ADD CONSTRAINT "station_playback_current_playlist_track_id_fkey" FOREIGN KEY ("current_playlist_track_id") REFERENCES "playlist_tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
