import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import {
  PreparationError,
  RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256,
  assertPreparationClosed,
  assertPreparationHash,
  preparationHash,
  samePreparationValue,
  type Common,
  type PreparationEntrySelection,
  type PreparationSession,
} from '@zhiju/contracts';
import { isUuidV7 } from '@zhiju/shared-kernel';
import {
  createCompanyRuleDatabase,
  PREPARATION_CREATOR_BINDINGS,
  PREPARATION_SERVICE_BINDINGS,
  PREPARATION_SERVICE_V2_BINDINGS,
  type IdentityCryptoPorts,
} from '@zhiju/identity-policy';
import { createCompanyStartupDatabase } from '@zhiju/enterprise-project';
import {
  createCustomerZipS3ObjectStore,
  createCustomerZipFileObjectStore,
  createPreparationCompanyFileReader,
  createPreparationCompanyS3Reader,
  type CustomerZipPolicyArtifact,
  type CustomerZipFileConfiguration,
} from '@zhiju/integration-gateway';
import { createCompanyRuleComposition } from '../composition/company-rule-entry.js';
import {
  createPreparationComposition,
  type PreparationCompositionConfig,
} from '../composition/preparation-composition.js';

export const PREPARATION_CONFIGURATION_INVALID = 'PREPARATION_CONFIGURATION_INVALID';
export interface PreparationEnvironmentDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly identityPool: Pool;
  readonly enterprisePool: Pool;
  readonly integrationPool: Pool;
  readonly crypto: IdentityCryptoPorts;
  readonly identityResolutionDeps: PreparationCompositionConfig['identityResolutionDeps'];
}
interface Deployment {
  grantAdministrators: string[];
  companyRuleGrantAdministrators: string[];
  administratorPolicySnapshotRef: Common.SnapshotRef;
  servicePrincipalId: string;
  enterpriseCapabilities: { select: string; create: string };
  capabilityCodes: Record<string, string>;
  selection: PreparationEntrySelection;
  policies: CustomerZipPolicyArtifact[];
  s3?: { endpoint: string; bucket: string; region: string };
  localFiles?: CustomerZipFileConfiguration;
  ticket: { activeKeyId: string };
  companySources: {
    sha256: string;
    objectKey: string;
    locators: { locator: string; offset: number; byteLength: number }[];
  }[];
}
function rejected(): never {
  throw new PreparationError(PREPARATION_CONFIGURATION_INVALID);
}
function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) rejected();
}
function nonempty(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) rejected();
}
function ids(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    !value.every((id: unknown) => typeof id === 'string' && isUuidV7(id)) ||
    new Set(value).size !== value.length
  )
    rejected();
}
function exactReference(
  value: unknown,
  kind: 'VERSIONED' | 'CONTENT_ADDRESSED' | 'SNAPSHOT',
  type: string,
) {
  record(value);
  assertPreparationClosed(value, [
    'kind',
    'objectType',
    'objectId',
    'scope',
    ...(kind === 'VERSIONED' ? ['versionId'] : []),
    ...(kind === 'SNAPSHOT' ? ['snapshotId'] : []),
    ...(kind !== 'VERSIONED' ? ['contentHash'] : []),
  ]);
  if (
    value.kind !== kind ||
    value.objectType !== type ||
    typeof value.objectId !== 'string' ||
    !isUuidV7(value.objectId)
  )
    rejected();
  record(value.scope);
  assertPreparationClosed(value.scope, []);
  const version =
    kind === 'VERSIONED' ? value.versionId : kind === 'SNAPSHOT' ? value.snapshotId : undefined;
  if (kind !== 'CONTENT_ADDRESSED' && (typeof version !== 'string' || !isUuidV7(version)))
    rejected();
  if (kind !== 'VERSIONED') assertPreparationHash(value.contentHash);
}
function decodeSecret(value: unknown, exactBytes?: number): Buffer {
  nonempty(value);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) rejected();
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.toString('base64') !== value ||
    (exactBytes === undefined ? bytes.length < 32 : bytes.length !== exactBytes)
  )
    rejected();
  return bytes;
}
function parseDeployment(raw: string): Deployment {
  const value: unknown = JSON.parse(raw);
  record(value);
  assertPreparationClosed(
    value,
    [
      'grantAdministrators',
      'companyRuleGrantAdministrators',
      'administratorPolicySnapshotRef',
      'servicePrincipalId',
      'enterpriseCapabilities',
      'capabilityCodes',
      'selection',
      'policies',
      'ticket',
      'companySources',
    ],
    ['s3', 'localFiles'],
  );
  ids(value.grantAdministrators);
  ids(value.companyRuleGrantAdministrators);
  if (typeof value.servicePrincipalId !== 'string' || !isUuidV7(value.servicePrincipalId))
    rejected();
  exactReference(value.administratorPolicySnapshotRef, 'SNAPSHOT', 'identity.policy_snapshot');
  record(value.enterpriseCapabilities);
  assertPreparationClosed(value.enterpriseCapabilities, ['select', 'create']);
  nonempty(value.enterpriseCapabilities.select);
  nonempty(value.enterpriseCapabilities.create);
  record(value.capabilityCodes);
  const operations = new Set<string>(
    [...PREPARATION_CREATOR_BINDINGS, ...PREPARATION_SERVICE_BINDINGS].map((row) => row[0]),
  );
  const v2Operations = PREPARATION_SERVICE_V2_BINDINGS.map((row) => row[0] + '@2.0');
  const allowedOperations = new Set([...operations, ...v2Operations]);
  for (const [operation, capability] of Object.entries(value.capabilityCodes)) {
    if (!allowedOperations.has(operation)) rejected();
    nonempty(capability);
  }
  for (const operation of operations) {
    if (!Object.hasOwn(value.capabilityCodes, operation)) rejected();
  }
  const capabilityCodes = value.capabilityCodes;
  if (v2Operations.some((operation) => Object.hasOwn(capabilityCodes, operation))) {
    for (const operation of v2Operations) {
      if (!Object.hasOwn(value.capabilityCodes, operation)) rejected();
    }
  }
  record(value.selection);
  assertPreparationClosed(value.selection, [
    'preparationPresetRef',
    'preparationPresetHash',
    'publicationRef',
  ]);
  exactReference(
    value.selection.preparationPresetRef,
    'VERSIONED',
    'zhiju.project.preparation_preset',
  );
  assertPreparationHash(value.selection.preparationPresetHash);
  exactReference(
    value.selection.publicationRef,
    'CONTENT_ADDRESSED',
    'zhiju.project.preparation_preset_publication',
  );
  if (!Array.isArray(value.policies) || !value.policies.length) rejected();
  if ((value.s3 === undefined) === (value.localFiles === undefined)) rejected();
  if (value.s3 !== undefined) {
    record(value.s3);
    assertPreparationClosed(value.s3, ['endpoint', 'bucket', 'region']);
    nonempty(value.s3.endpoint);
    nonempty(value.s3.bucket);
    nonempty(value.s3.region);
  } else {
    record(value.localFiles);
    assertPreparationClosed(value.localFiles, ['mode', 'root', 'identity']);
    record(value.localFiles.identity);
    assertPreparationClosed(value.localFiles.identity, ['storeId', 'device', 'inode']);
    if (value.localFiles.mode !== 'MACOS_MANUAL_TEST') rejected();
    nonempty(value.localFiles.root);
  }
  record(value.ticket);
  assertPreparationClosed(value.ticket, ['activeKeyId']);
  nonempty(value.ticket.activeKeyId);
  if (!Array.isArray(value.companySources) || !value.companySources.length) rejected();
  const hashes = new Set<string>();
  for (const source of value.companySources as unknown[]) {
    record(source);
    assertPreparationClosed(source, ['sha256', 'objectKey', 'locators']);
    if (
      typeof source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.sha256) ||
      hashes.has(source.sha256)
    )
      rejected();
    hashes.add(source.sha256);
    nonempty(source.objectKey);
    if (!Array.isArray(source.locators)) rejected();
    const names = new Set<string>();
    for (const item of source.locators as unknown[]) {
      record(item);
      assertPreparationClosed(item, ['locator', 'offset', 'byteLength']);
      nonempty(item.locator);
      if (
        names.has(item.locator) ||
        !Number.isSafeInteger(item.offset) ||
        Number(item.offset) < 0 ||
        !Number.isSafeInteger(item.byteLength) ||
        Number(item.byteLength) < 1 ||
        Number(item.offset) + Number(item.byteLength) > 104857600
      )
        rejected();
      names.add(item.locator);
    }
  }
  return value as unknown as Deployment;
}
/** Optional, closed deployment assembly. It never publishes business facts or grants. */
export function createPreparationEnvironment(
  deps: PreparationEnvironmentDependencies,
): ReturnType<typeof createPreparationComposition> | undefined {
  const raw = deps.env.ZHIJU_PREPARATION_CONFIG;
  if (raw === undefined) return undefined;
  try {
    const config = parseDeployment(raw);
    const cursorKey = decodeSecret(deps.env.ZHIJU_PREPARATION_CURSOR_KEY);
    const ticketDocument: unknown = JSON.parse(deps.env.ZHIJU_PREPARATION_TICKET_KEYS ?? '');
    record(ticketDocument);
    const ticketKeys = new Map<string, Uint8Array>();
    for (const [id, key] of Object.entries(ticketDocument)) {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(id)) rejected();
      ticketKeys.set(id, decodeSecret(key, 32));
    }
    if (!ticketKeys.has(config.ticket.activeKeyId)) rejected();
    let cached: PreparationSession | undefined;
    function currentServiceSession(): Promise<PreparationSession> {
      const current = new Date();
      if (!cached || Date.parse(cached.expiresAt) <= current.getTime()) {
        cached = {
          principalId: config.servicePrincipalId,
          authenticationContextHash: preparationHash({
            principalId: config.servicePrincipalId,
            issuedAt: current.toISOString(),
            nonce: randomBytes(32).toString('base64url'),
            purpose: 'preparation.internal.service',
          }),
          expiresAt: new Date(current.getTime() + 300000).toISOString(),
        };
      }
      return Promise.resolve(cached);
    }
    async function verifyCompanyService(session: PreparationSession) {
      const actual = await currentServiceSession();
      if (
        session.principalId !== config.servicePrincipalId ||
        !samePreparationValue(session, actual) ||
        Date.parse(session.expiresAt) <= Date.now()
      )
        throw new PreparationError('AUTHORIZATION_DENIED');
    }
    const stores = (() => {
      if (config.localFiles) {
        if (
          deps.env.ZHIJU_WORKSPACE_DEPLOYMENT_MODE !== 'MACOS_MANUAL_TEST' ||
          process.platform !== 'darwin'
        )
          rejected();
        return {
          objectStore: createCustomerZipFileObjectStore(config.localFiles),
          companyReader: createPreparationCompanyFileReader(
            config.localFiles,
            config.companySources.map((source) => source.objectKey),
          ),
        };
      }
      if (!config.s3) rejected();
      const accessKeyId = deps.env.ZHIJU_PREPARATION_S3_ACCESS_KEY_ID;
      const secretAccessKey = deps.env.ZHIJU_PREPARATION_S3_SECRET_ACCESS_KEY;
      nonempty(accessKeyId);
      nonempty(secretAccessKey);
      const token = deps.env.ZHIJU_PREPARATION_S3_SESSION_TOKEN;
      if (token !== undefined) nonempty(token);
      const s3 = {
        ...config.s3,
        accessKeyId,
        secretAccessKey,
        ...(token ? { sessionToken: token } : {}),
      };
      return {
        objectStore: createCustomerZipS3ObjectStore(s3),
        companyReader: createPreparationCompanyS3Reader(
          s3,
          config.companySources.map((source) => source.objectKey),
        ),
      };
    })();
    const { objectStore, companyReader } = stores;
    const sourceBindings = new Map(config.companySources.map((source) => [source.sha256, source]));
    const sources = {
      read: async (ref: Common.ContentAddressedRef) => {
        const binding = sourceBindings.get(ref.contentHash.digest);
        if (!binding) throw new PreparationError('DEPENDENCY_UNAVAILABLE');
        const bytes = Buffer.from(await companyReader.read(binding.objectKey));
        if (createHash('sha256').update(bytes).digest('hex') !== binding.sha256)
          throw new PreparationError('DEPENDENCY_UNAVAILABLE');
        return bytes;
      },
      locate: (bytes: Buffer, locator: string) => {
        const hash = createHash('sha256').update(bytes).digest('hex');
        const binding = sourceBindings.get(hash)?.locators.find((item) => item.locator === locator);
        if (!binding || binding.offset + binding.byteLength > bytes.length)
          return Promise.reject(new PreparationError('DEPENDENCY_UNAVAILABLE'));
        return Promise.resolve([
          bytes.subarray(binding.offset, binding.offset + binding.byteLength),
        ]);
      },
    };
    const companyRules = createCompanyRuleComposition({
      identity: {
        db: createCompanyRuleDatabase(deps.identityPool),
        grantAdministrators: config.companyRuleGrantAdministrators,
        verifySession: verifyCompanyService,
      },
      enterprise: {
        db: createCompanyStartupDatabase(deps.enterprisePool),
        sources,
        sourcePolicy: { provenance: 'PRODUCTION' },
      },
      dependencySession: currentServiceSession,
    });
    return createPreparationComposition({
      identityPool: deps.identityPool,
      enterprisePool: deps.enterprisePool,
      integrationPool: deps.integrationPool,
      crypto: deps.crypto,
      identityResolutionDeps: deps.identityResolutionDeps,
      grantAdministrators: config.grantAdministrators,
      administratorPolicySnapshotRef: config.administratorPolicySnapshotRef,
      serviceSession: currentServiceSession,
      servicePrincipalIds: [config.servicePrincipalId],
      enterpriseCapabilities: config.enterpriseCapabilities,
      capabilityCodes: config.capabilityCodes,
      selection: config.selection,
      cursorKey,
      ticket: { activeKeyId: config.ticket.activeKeyId, keys: ticketKeys },
      policies: config.policies,
      companyRules,
      analysisBasis: {
        sources: {
          readTemplate: sources.read,
          locate: sources.locate,
          readInstruction: async (sha256) => {
            const binding = sourceBindings.get(sha256);
            if (!binding) throw new PreparationError('DEPENDENCY_UNAVAILABLE');
            const bytes = Buffer.from(await companyReader.read(binding.objectKey));
            if (createHash('sha256').update(bytes).digest('hex') !== sha256)
              throw new PreparationError('DEPENDENCY_UNAVAILABLE');
            return bytes;
          },
        },
        validateDefinition: (basis) => {
          if (basis.reportSchemaSha256 !== RUNNER_ANALYSIS_REPORT_SCHEMA_SHA256)
            throw new PreparationError('PREPARATION_ANALYSIS_PROFILE_UNSUPPORTED');
        },
      },
      objectStore,
    });
  } catch {
    rejected();
  }
}
