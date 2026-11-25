import { Module } from '@nestjs/common';
import { StorageModule } from '../../storage/storage.module.js';
import { StationsModule } from '../stations/stations.module.js';
import { StreamingModule } from '../streaming/streaming.module.js';
import { InternalStreamController } from './internal-stream.controller.js';
import { PlaybackController } from './playback.controller.js';
import { PlaybackService } from './playback.service.js';

@Module({
  imports: [StorageModule, StationsModule, StreamingModule],
  controllers: [InternalStreamController, PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
