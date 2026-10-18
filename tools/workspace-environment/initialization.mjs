import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { deploymentFingerprint, writePrivateJson } from './config.mjs';

async function identitiesHash(config) {
  const content = await readFile(join(config.dataDir, 'identities.json'), 'utf8');
  if (JSON.parse(content)?.instanceId !== config.instanceId)
    throw new Error('ENV_B_DATA_OWNER_MISMATCH');
  return createHash('sha256').update(content).digest('hex');
}

async function preparationHash(config) {
  const files = [
    'preparation-deployment.json',
    'preparation-installation.json',
    'object-store-binding.json',
  ];
  const digest = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(join(config.dataDir, file));
    const value = JSON.parse(bytes.toString('utf8'));
    if (file === 'preparation-installation.json' && value.instanceId !== config.instanceId)
      throw new Error('ENV_B_DATA_OWNER_MISMATCH');
    digest.update(file).update('\0').update(bytes).update('\0');
  }
  return digest.digest('hex');
}

/** A failed retry must not retain an older successful initialization marker. */
export async function invalidateInitialization(config) {
  await rm(join(config.dataDir, 'initialized.json'), { force: true });
}

export async function recordInitialization(config) {
  await writePrivateJson(join(config.dataDir, 'initialized.json'), {
    version: 2,
    instanceId: config.instanceId,
    configurationHash: deploymentFingerprint(config),
    identitiesHash: await identitiesHash(config),
    preparationHash: await preparationHash(config),
  });
}

/** Status remains usable without built owner packages or an available Runner directory. */
export async function initializationComplete(config) {
  try {
    const marker = JSON.parse(await readFile(join(config.dataDir, 'initialized.json'), 'utf8'));
    return (
      marker !== null &&
      typeof marker === 'object' &&
      Object.keys(marker).sort().join(',') ===
        'configurationHash,identitiesHash,instanceId,preparationHash,version' &&
      marker.version === 2 &&
      marker.instanceId === config.instanceId &&
      marker.configurationHash === deploymentFingerprint(config) &&
      marker.identitiesHash === (await identitiesHash(config)) &&
      marker.preparationHash === (await preparationHash(config))
    );
  } catch (error) {
    if (
      error.code === 'ENOENT' ||
      error instanceof SyntaxError ||
      error.message === 'ENV_B_DATA_OWNER_MISMATCH'
    )
      return false;
    throw new Error('ENV_B_INITIALIZATION_CHECK_FAILED', { cause: error });
  }
}
