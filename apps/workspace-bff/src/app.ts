import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import fastify from 'fastify';
import type { FetchLike } from './oidc.js';
import { OidcProvider } from './oidc.js';
import { createRequestHandler } from './routes.js';
import { SessionStore } from './sessions.js';
import { UI_ERROR } from './support.js';
import { LoginTransactionStore } from './transactions.js';
import { loadBffTrustConfigFromEnv } from './trust-config.js';

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

export interface CreateBffOptions {
  env?: Record<string, string | undefined>;
  clock?: () => number;
  fetchImpl?: FetchLike;
  /** Bounded wait for an in-flight single-flight refresh before failing closed. */
  refreshWaitMs?: number;
  loginTransactionTtlMs?: number;
  sessionIdleMs?: number;
  sessionAbsoluteMs?: number;
}

const LOGIN_TRANSACTION_TTL_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const REFRESH_WAIT_MS = 10_000;

/**
 * Single composition entry for the BFF. With no trust configuration the process
 * keeps today's anonymous shell contract (health/bootstrap 200, everything else
 * 503/404) and degrades closed instead of crashing on absent config or Core.
 */
export async function createBff(options: CreateBffOptions = {}): Promise<NestFastifyApplication> {
  const env = options.env ?? process.env;
  const clock = options.clock ?? (() => Date.now());
  const fetchImpl = options.fetchImpl ?? fetch;
  const trust = loadBffTrustConfigFromEnv(env);

  // Pass the approved direct version rather than Nest's older transitive Fastify.
  const server = fastify({ logger: false, bodyLimit: 16_384 });
  // Nest 11.2.1 declares the instance against its transitive Fastify 5.11.3.
  // Keep native 5.12 types for our hooks and bridge only this adapter boundary;
  // the built-application gate checks the actual version and request behavior.
  const adapter = new FastifyAdapter(
    server as unknown as ConstructorParameters<typeof FastifyAdapter>[0],
  );
  const app = await NestFactory.create<NestFastifyApplication>(ShellModule, adapter, {
    logger: false,
  });

  const handler =
    trust.status === 'CONFIGURED'
      ? createRequestHandler({
          loaded: trust.loaded,
          provider: new OidcProvider(trust.loaded.config, {
            fetchImpl,
            clientSecret: trust.loaded.clientAuthSecret,
            now: clock,
          }),
          transactions: new LoginTransactionStore({
            maxTotal: trust.loaded.config.maxLoginTransactions,
            maxPerBrowser: trust.loaded.config.maxTransactionsPerBrowser,
            ttlMs: options.loginTransactionTtlMs ?? LOGIN_TRANSACTION_TTL_MS,
            now: clock,
          }),
          sessions: new SessionStore({
            maxSessions: trust.loaded.config.maxSessions,
            idleMs: options.sessionIdleMs ?? SESSION_IDLE_MS,
            absoluteMs: options.sessionAbsoluteMs ?? SESSION_ABSOLUTE_MS,
            now: clock,
          }),
          now: clock,
          fetchImpl,
          refreshWaitMs: options.refreshWaitMs ?? REFRESH_WAIT_MS,
        })
      : undefined;

  server.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (handler === undefined) {
      const path = request.url.split('?')[0];
      if (request.method !== 'GET' || !['/bff/health', '/bff/bootstrap'].includes(path ?? '')) {
        await reply.status(503).send({
          code: UI_ERROR.SERVICE_NOT_CONFIGURED,
          message: '登录与公开业务服务尚未接入，暂不能执行此操作。',
          retryable: false,
        });
      }
      return;
    }
    await handler(request, reply);
  });

  await app.init();
  return app;
}
