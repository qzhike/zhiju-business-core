import { lockPathFor } from './locks.js';

/** Server-generated object keys; client paths never enter the host path. */
export function originalObjectKey(
  ownerId: string,
  projectId: string,
  batchId: string,
  attemptId: string,
): string {
  return `original/${ownerId}/${projectId}/${batchId}/${attemptId}`;
}

export function entryObjectKey(
  ownerId: string,
  projectId: string,
  batchId: string,
  extractAttemptId: string,
  ordinal: number,
): string {
  return `entries/${ownerId}/${projectId}/${batchId}/${extractAttemptId}/${ordinal}`;
}

export function stagingObjectKey(attemptId: string): string {
  return `staging/${attemptId}`;
}

export function attemptLockPath(root: string, attemptId: string): string {
  return lockPathFor(`${root}\0attempt\0${attemptId}`);
}

export function instanceLockPath(root: string, instanceId: string): string {
  return lockPathFor(`${root}\0instance\0${instanceId}`);
}
