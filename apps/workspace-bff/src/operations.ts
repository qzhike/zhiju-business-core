import { isPlainObject, isUuidLike } from './support.js';

/**
 * Finite first-version public operation set. The BFF never dispatches arbitrary
 * Registry operations: the URL token must be one of these verbatim.
 */
const QUERY_OPERATIONS: Record<string, true> = {
  'artifact.get_file_review_content@1.0': true,
  'artifact.get_file_change_directory@1.0': true,
  'artifact.resolve_file_review_locations@1.0': true,
  'artifact.get_markdown_download@1.0': true,
  'project.find_workspace_projects@1.0': true,
  'project.get_project_board_slice@1.0': true,
  'execution.get_task_board_slice@1.0': true,
  'quality.get_evidence@1.0': true,
};

/** No command has an owning registered transport in the first version. */
const COMMAND_OPERATIONS: Record<string, true> = {};

const OVERRIDE_BODY_KEYS: Record<string, true> = {
  actor: true,
  actingFor: true,
  requester: true,
  authorizationDecisionRef: true,
  authenticationContextRef: true,
  roles: true,
  policySnapshot: true,
};

/** Public override headers are rejected instead of being silently stripped. */
const OVERRIDE_HEADERS: Record<string, true> = {
  authorization: true,
  'x-actor': true,
  'x-principal': true,
  'x-authorization-decision': true,
  'x-workspace-session-binding': true,
  'x-workspace-trust-config-hash': true,
  'x-authentication-context': true,
};

const BASE_QUERY_KEYS: Record<string, true> = {
  queryId: true,
  type: true,
  version: true,
  scopeRef: true,
  consistencyRequirement: true,
  pagination: true,
  correlationId: true,
  requestedAt: true,
  payload: true,
  integrity: true,
  minimumWatermark: true,
  asOf: true,
};

const BASE_COMMAND_KEYS: Record<string, true> = {
  commandId: true,
  type: true,
  version: true,
  scopeRef: true,
  targetRef: true,
  expectedAggregateVersion: true,
  idempotencyKey: true,
  correlationId: true,
  requestedAt: true,
  payload: true,
  integrity: true,
  causationId: true,
  deadline: true,
};

export type OperationKind = 'queries' | 'commands';

export interface OperationPath {
  kind: OperationKind;
  operation: string;
  version: string;
}

export class OperationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationRequestError';
  }
}

const OPERATION_SEGMENT = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const VERSION_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * One canonical path parse. Percent-encoding is rejected outright so an
 * encoded separator can never smuggle a second interpretation of the route.
 */
export function parseOperationPath(path: string): OperationPath | undefined {
  const segments = path.split('/');
  if (segments.length !== 5) return undefined;
  const [, root, kind, operation, version] = segments as [string, string, string, string, string];
  if (root !== 'bff' || (kind !== 'queries' && kind !== 'commands')) return undefined;
  if (path.includes('%') || path.includes('\\')) throw new OperationRequestError('encoded path');
  if (operation === '.' || operation === '..' || version === '.' || version === '..') {
    throw new OperationRequestError('invalid path segment');
  }
  if (!OPERATION_SEGMENT.test(operation) || !VERSION_SEGMENT.test(version)) {
    throw new OperationRequestError('invalid operation path');
  }
  return { kind, operation, version };
}

export function operationRegistered(input: OperationPath): boolean {
  const key = `${input.operation}@${input.version}`;
  const table = input.kind === 'queries' ? QUERY_OPERATIONS : COMMAND_OPERATIONS;
  return Object.hasOwn(table, key);
}

export function assertNoOverrideHeaders(
  headers: Record<string, string | string[] | undefined>,
): void {
  for (const name of Object.keys(OVERRIDE_HEADERS)) {
    if (headers[name] !== undefined) throw new OperationRequestError(`override header ${name}`);
  }
}

function requireKey(
  body: Record<string, unknown>,
  allowed: Record<string, true>,
  key: string,
): unknown {
  for (const name of Object.keys(body)) {
    if (Object.hasOwn(OVERRIDE_BODY_KEYS, name)) {
      throw new OperationRequestError(`override field ${name}`);
    }
    if (!Object.hasOwn(allowed, name)) throw new OperationRequestError(`unknown field ${name}`);
  }
  const value = body[key];
  if (value === undefined) throw new OperationRequestError(`missing field ${key}`);
  return value;
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OperationRequestError(`invalid field ${key}`);
  }
  return value;
}

function validateIntegrity(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) throw new OperationRequestError('invalid integrity');
  const payloadHash = value.payloadHash;
  if (value.canonicalizationVersion !== '1' || !isPlainObject(payloadHash)) {
    throw new OperationRequestError('invalid integrity');
  }
  if (payloadHash.algorithm !== 'SHA-256' || payloadHash.canonicalizationVersion !== '1') {
    throw new OperationRequestError('invalid integrity');
  }
  if (typeof payloadHash.digest !== 'string' || payloadHash.digest.length === 0) {
    throw new OperationRequestError('invalid integrity');
  }
}

function validatePagination(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isPlainObject(value)) throw new OperationRequestError('invalid pagination');
  const pageSize = value.pageSize;
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new OperationRequestError('invalid pagination');
  }
  const cursor = value.cursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0)) {
    throw new OperationRequestError('invalid pagination');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'pageSize' && key !== 'cursor') {
      throw new OperationRequestError('invalid pagination');
    }
  }
}

/**
 * Validates the closed public projection: the body must be byte-for-byte the
 * same envelope shape the BFF forwards to Core, with no caller-supplied actor,
 * decision or requester field.
 */
export function validateQueryProjection(body: Record<string, unknown>): void {
  requireKey(body, BASE_QUERY_KEYS, 'queryId');
  const queryId = requireString(body.queryId, 'queryId');
  if (!isUuidLike(queryId)) throw new OperationRequestError('invalid queryId');
  requireString(body.type, 'type');
  requireString(body.version, 'version');
  if (!isPlainObject(body.scopeRef)) throw new OperationRequestError('invalid scopeRef');
  const consistency = body.consistencyRequirement;
  if (typeof consistency === 'string' ? consistency.length === 0 : !isPlainObject(consistency)) {
    throw new OperationRequestError('invalid consistencyRequirement');
  }
  const correlationId = requireString(
    requireKey(body, BASE_QUERY_KEYS, 'correlationId'),
    'correlationId',
  );
  if (!isUuidLike(correlationId)) throw new OperationRequestError('invalid correlationId');
  requireString(body.requestedAt, 'requestedAt');
  if (!isPlainObject(body.payload)) throw new OperationRequestError('invalid payload');
  validatePagination(body.pagination);
  validateIntegrity(body.integrity);
}

export function validateCommandProjection(body: Record<string, unknown>): void {
  requireKey(body, BASE_COMMAND_KEYS, 'commandId');
  const commandId = requireString(body.commandId, 'commandId');
  if (!isUuidLike(commandId)) throw new OperationRequestError('invalid commandId');
  requireString(body.type, 'type');
  requireString(body.version, 'version');
  if (!isPlainObject(body.scopeRef)) throw new OperationRequestError('invalid scopeRef');
  if (!isPlainObject(body.targetRef)) throw new OperationRequestError('invalid targetRef');
  requireString(body.idempotencyKey, 'idempotencyKey');
  const correlationId = requireString(
    requireKey(body, BASE_COMMAND_KEYS, 'correlationId'),
    'correlationId',
  );
  if (!isUuidLike(correlationId)) throw new OperationRequestError('invalid correlationId');
  requireString(body.requestedAt, 'requestedAt');
  if (!isPlainObject(body.payload)) throw new OperationRequestError('invalid payload');
  validateIntegrity(body.integrity);
}
