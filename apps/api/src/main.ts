import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastify from 'fastify';

import { AppModule } from './app.module.js';
import { WORKSPACE_BODY_LIMIT_BYTES, registerWorkspaceTransport } from './workspace/controller.js';
import {
  createWorkspaceCoreFromEnv,
  WORKSPACE_STARTUP_REJECTED,
  WorkspaceStartupError,
} from './workspace/server.js';

/**
 * A missing or invalid deployment value is a startup rejection, not a degraded
 * listener (Session Delta §1): when the trusted workspace runtime cannot be
 * built the process logs exactly one safe code line, sets a non-zero exit and
 * never listens. The log line carries only the fixed code — no secret, key,
 * connection string or environment value is ever emitted.
 */
const runtime = (() => {
  try {
    return createWorkspaceCoreFromEnv(process.env);
  } catch (error) {
    const code = error instanceof WorkspaceStartupError ? error.code : WORKSPACE_STARTUP_REJECTED;
    console.error(`${WORKSPACE_STARTUP_REJECTED} ${code}`);
    process.exitCode = 1;
    return undefined;
  }
})();

if (runtime !== undefined) {
  const server = fastify({ logger: false, bodyLimit: WORKSPACE_BODY_LIMIT_BYTES });
  // Nest 11.2.1 declares the adapter against its transitive Fastify 5.11.3; we
  // pass the approved direct 5.12 instance and bridge only this adapter boundary.
  const adapter = new FastifyAdapter(
    server as unknown as ConstructorParameters<typeof FastifyAdapter>[0],
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(runtime),
    adapter,
    { bufferLogs: true },
  );
  registerWorkspaceTransport(server, runtime);
  await app.listen({ host: '127.0.0.1', port: 3000 });
}
