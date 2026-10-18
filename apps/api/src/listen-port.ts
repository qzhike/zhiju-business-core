/** Keep the historical default while allowing an isolated local Core instance. */
export function coreListenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? '3000';
  if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) {
    throw new Error('WORKSPACE_LISTEN_PORT_INVALID');
  }
  return Number(raw);
}
