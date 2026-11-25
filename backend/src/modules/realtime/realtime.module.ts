import { Module } from '@nestjs/common';
import { PlaybackModule } from '../playback/playback.module.js';
import { StationsModule } from '../stations/stations.module.js';
import { IcecastStatusService } from './icecast-status.service.js';
import { RadioGateway } from './radio.gateway.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Read-only real-time metadata (Socket.IO). Audio never goes through it. Depends on the stations
 * and playback modules (never the other way round), which notify it through plain listeners.
 */
@Module({
  imports: [StationsModule, PlaybackModule],
  providers: [RealtimeService, IcecastStatusService, RadioGateway],
})
export class RealtimeModule {}
