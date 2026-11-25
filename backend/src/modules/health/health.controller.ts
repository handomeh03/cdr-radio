import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { HealthService, type HealthReport } from './health.service.js';

/** Public and not rate-limited: polled by uptime/health checks. */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** 200 when the API and PostgreSQL are reachable, 503 otherwise. */
  @Get()
  async check(): Promise<HealthReport> {
    const report = await this.healthService.check();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
