import fastify from 'fastify';

import { MvpStartupError } from './mvp/config.js';
import { MVP_JSON_BODY_LIMIT, registerMvpTransport } from './mvp/http.js';
import { createMvpCoreRuntime } from './mvp/runtime.js';

/**
 * The dedicated MVP Core composition. It listens only after the installation,
 * store identity, operator binding and PostgreSQL schema have been verified;
 * a missing or mismatched value logs one fixed code and never starts a partial
 * entry point.
 */
const runtime = await createMvpCoreRuntime(process.env).catch((error: unknown) => {
  const code = error instanceof MvpStartupError ? error.code : 'MVP_CORE_STARTUP_REJECTED';
  console.error(`MVP_CORE_STARTUP_REJECTED ${code}`);
  process.exitCode = 1;
  return undefined;
});

if (runtime !== undefined) {
  const server = fastify({ logger: false, bodyLimit: MVP_JSON_BODY_LIMIT });
  registerMvpTransport(server, runtime);
  const shutdown = async (): Promise<void> => {
    await server.close();
    await runtime.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  await server.listen({ host: runtime.config.host, port: runtime.config.port });
}
