import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): Readonly<{ status: 'ok' }> {
    return { status: 'ok' };
  }
}
