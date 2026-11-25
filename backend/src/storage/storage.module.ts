import { Module } from '@nestjs/common';
import { R2StorageService } from './r2-storage.service.js';

/** Private Cloudflare R2 object storage, shared by features that store files. */
@Module({
  providers: [R2StorageService],
  exports: [R2StorageService],
})
export class StorageModule {}
