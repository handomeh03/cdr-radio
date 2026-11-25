import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { StorageModule } from '../../storage/storage.module.js';
import {
  AudioProcessingService,
  newUploadFileName,
  resolveAudioWorkDir,
} from './audio/audio-processing.service.js';
import { TracksController } from './tracks.controller.js';
import { TracksService } from './tracks.service.js';

@Module({
  imports: [
    StorageModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        // Streams to the controlled temp dir under a generated name (never the client's filename).
        storage: diskStorage({
          destination: resolveAudioWorkDir(config),
          filename: (_req, _file, done) => done(null, newUploadFileName()),
        }),
        limits: {
          fileSize:
            config.get('AUDIO_UPLOAD_MAX_MB', { infer: true }) * 1024 * 1024,
          files: 1,
          fields: 5,
          fieldSize: 4 * 1024,
          parts: 8,
        },
      }),
    }),
  ],
  controllers: [TracksController],
  providers: [TracksService, AudioProcessingService],
})
export class TracksModule {}
