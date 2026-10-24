import {
  FORBIDDEN_BROWSER_OVERRIDE_HEADERS,
  SESSION_BINDING_HEADER,
  TRUST_CONFIG_HASH_HEADER,
  createAccessTokenVerifier,
  type AccessTokenVerifier,
  type WorkspaceHeaders,
} from '../workspace/access-token.js';
import { peerAllowed, normalizeRemoteAddress } from '../workspace/net.js';
import {
  MvpDatabase as Database,
  MvpError,
  MvpService as Service,
  acquireExclusiveLock,
  instanceLockPath,
  openMvpFileStore,
  type MvpDatabase,
  type MvpFileStore,
  type MvpService,
} from '@zhiju/document-delivery';

import { loadMvpCoreConfig, type MvpCoreConfig } from './config.js';

export interface MvpVerifiedIdentity {
  readonly ownerId: string;
  readonly displayName: string;
  readonly authEpoch: number;
}

export interface MvpCoreRuntime {
  readonly config: MvpCoreConfig;
  readonly store: MvpFileStore;
  readonly database: MvpDatabase;
  readonly service: MvpService;
  readonly verifier: AccessTokenVerifier;
  isTrustedPeer(remoteAddress: string | undefined): boolean;
  authenticate(input: {
    readonly remoteAddress: string | undefined;
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  }): Promise<MvpVerifiedIdentity>;
  close(): Promise<void>;
}

function single(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function rejection(error: { code: string; status: number }): never {
  throw new MvpError(error.status === 503 ? 'DEPENDENCY_UNAVAILABLE' : 'AUTHENTICATION_REQUIRED');
}

export async function createMvpCoreRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MvpCoreRuntime> {
  const config = loadMvpCoreConfig(env);
  const verifier = createAccessTokenVerifier({ trustConfig: config.trust });
  const store = await openMvpFileStore({
    root: config.storeRoot,
    expected: {
      instanceId: config.instanceId,
      storeId: config.storeId,
      storeIdentity: config.storeIdentity,
    },
  });
  const instanceLock = await acquireExclusiveLock(instanceLockPath(store.root, config.instanceId));
  if (instanceLock === null) throw new Error('MVP_INSTANCE_IN_USE');
  const database = new Database({ connectionString: config.databaseUrl });
  const service = new Service({
    database,
    store,
    cursorKey: config.cursorKey,
    incarnation: config.incarnation,
  });
  try {
    await service.startup();
    await service.resumePendingExtractions();
  } catch (error) {
    await database.close();
    await instanceLock.release();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const isTrustedPeer = (remoteAddress: string | undefined): boolean =>
    remoteAddress !== undefined && peerAllowed(config.trust, normalizeRemoteAddress(remoteAddress));
  return {
    config,
    store,
    database,
    service,
    verifier,
    isTrustedPeer,
    async authenticate(input) {
      if (!isTrustedPeer(input.remoteAddress)) throw new MvpError('AUTHENTICATION_REQUIRED');
      for (const name of FORBIDDEN_BROWSER_OVERRIDE_HEADERS)
        if (input.headers[name] !== undefined) throw new MvpError('INVALID_REQUEST');
      const headers: WorkspaceHeaders = {
        authorization: input.headers.authorization,
        [SESSION_BINDING_HEADER]: input.headers[SESSION_BINDING_HEADER],
        [TRUST_CONFIG_HASH_HEADER]: input.headers[TRUST_CONFIG_HASH_HEADER],
      };
      const binding = verifier.verifySessionBindingHeaders(headers);
      if (!binding.ok) rejection(binding);
      const authorization = single(input.headers, 'authorization');
      if (!authorization?.startsWith('Bearer ')) throw new MvpError('AUTHENTICATION_REQUIRED');
      const token = authorization.slice('Bearer '.length);
      if (token.length === 0 || token.length > 16 * 1024)
        throw new MvpError('AUTHENTICATION_REQUIRED');
      const verified = await verifier.verify(token, binding.sessionBinding);
      if (!verified.ok) rejection(verified);
      const bindingRecord = await service.resolveBinding(
        verified.context.issuer,
        verified.context.subjectExternalId,
      );
      if (!bindingRecord?.enabled) throw new MvpError('INSTANCE_ACCESS_DENIED');
      return {
        ownerId: bindingRecord.ownerId,
        displayName: bindingRecord.displayName,
        authEpoch: bindingRecord.authEpoch,
      };
    },
    close() {
      // The transport closes its entry point before calling runtime.close().
      // Keep ownership until all scheduled writers and database work finish.
      closing ??= (async () => {
        await service.whenIdle();
        await database.close();
        await instanceLock.release();
      })();
      return closing;
    },
  };
}
