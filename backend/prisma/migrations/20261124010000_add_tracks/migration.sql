-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "artist" VARCHAR(200),
    "status" "TrackStatus" NOT NULL DEFAULT 'PROCESSING',
    "duration_ms" INTEGER,
    "source_format" VARCHAR(32),
    "size_bytes" INTEGER,
    "storage_key" TEXT,
    "error_message" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tracks_storage_key_key" ON "tracks"("storage_key");

-- CreateIndex
CREATE INDEX "tracks_status_idx" ON "tracks"("status");

-- CreateIndex
CREATE INDEX "tracks_created_at_idx" ON "tracks"("created_at");
