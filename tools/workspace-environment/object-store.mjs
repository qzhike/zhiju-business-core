import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initializeCustomerZipFileStore } from '@zhiju/integration-gateway';
import { writePrivateJson } from './config.mjs';

/** Resume only the completed store marker named by this instance's prior private intent. */
export async function initializePreparationObjectStore(config) {
  const root = join(config.dataDir, 'objects');
  const bindingFile = join(config.dataDir, 'object-store-binding.json');
  try {
    const binding = JSON.parse(await readFile(bindingFile, 'utf8'));
    if (binding.mode !== 'MACOS_MANUAL_TEST' || binding.root !== root)
      throw new Error('ENV_B_FILE_STORE_BINDING_MISMATCH');
    return binding;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const intentFile = join(config.dataDir, 'object-store-initialization.json');
  let intent;
  let existingIntent = true;
  try {
    intent = JSON.parse(await readFile(intentFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await lstat(root);
      throw new Error('ENV_B_FILE_STORE_UNBOUND', { cause: error });
    } catch (rootError) {
      if (rootError.code !== 'ENOENT') throw rootError;
    }
    intent = { version: 1, instanceId: config.instanceId, root, storeId: randomUUID() };
    await writePrivateJson(intentFile, intent, true);
    existingIntent = false;
  }
  if (
    Object.keys(intent).sort().join(',') !== 'instanceId,root,storeId,version' ||
    intent.version !== 1 ||
    intent.instanceId !== config.instanceId ||
    intent.root !== root ||
    typeof intent.storeId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(intent.storeId)
  )
    throw new Error('ENV_B_FILE_STORE_INITIALIZATION_MISMATCH');
  // An earlier intent alone cannot prove that a now-missing directory is unused.
  if (existingIntent) {
    try {
      await lstat(root);
    } catch (error) {
      throw new Error('ENV_B_FILE_STORE_INITIALIZATION_INCOMPLETE', { cause: error });
    }
  }
  let binding;
  try {
    binding = await initializeCustomerZipFileStore({
      mode: 'MACOS_MANUAL_TEST',
      root,
      storeId: intent.storeId,
    });
  } catch (error) {
    throw new Error('ENV_B_FILE_STORE_INITIALIZATION_INCOMPLETE', { cause: error });
  }
  await writePrivateJson(bindingFile, binding, true);
  return binding;
}
