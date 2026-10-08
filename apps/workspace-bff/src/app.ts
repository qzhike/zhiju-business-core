import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

@Controller('bff')
class ShellController {
  @Get('health')
  health() {
    return { status: 'ok', businessIntegration: 'NOT_CONFIGURED' };
  }

  @Get('bootstrap')
  bootstrap() {
    // Configured URLs alone do not constitute a verified OIDC session or proxy.
    return { accessState: 'REAUTH_REQUIRED', businessActionsEnabled: false };
  }
}

@Module({ controllers: [ShellController] })
class ShellModule {}

export async function createBff(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ logger: false, bodyLimit: 16_384 });
  const app = await NestFactory.create<NestFastifyApplication>(ShellModule, adapter, {
    logger: false,
  });
  const server = adapter.getInstance();
  server.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    const path = request.url.split('?')[0];
    if (request.method !== 'GET' || !['/bff/health', '/bff/bootstrap'].includes(path ?? '')) {
      await reply.status(503).send({
        code: 'UI_SERVICE_NOT_CONFIGURED',
        message: '登录与公开业务服务尚未接入，暂不能执行此操作。',
        retryable: false,
      });
    }
  });
  await app.init();
  return app;
}
