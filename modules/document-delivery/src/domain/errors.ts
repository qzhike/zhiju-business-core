/**
 * The frozen MVP v1 error vocabulary
 * (`.vibe/api-contract-v0.1/API-Contract-v0.1.md#mvp-v1-b1-共享协议已批准设计`).
 * Messages are fixed, safe text: they never carry payloads, notes, subjects,
 * tokens, SQL or storage paths.
 */

export const MVP_ERROR = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INSTANCE_ACCESS_DENIED: 'INSTANCE_ACCESS_DENIED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  TARGET_EXISTS: 'TARGET_EXISTS',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  PROJECT_BUSY: 'PROJECT_BUSY',
  UPLOAD_BUSY: 'UPLOAD_BUSY',
  BATCH_SEALED: 'BATCH_SEALED',
  RECOVERY_NOT_ALLOWED: 'RECOVERY_NOT_ALLOWED',
  MANIFEST_NOT_READY: 'MANIFEST_NOT_READY',
  CURSOR_INVALID: 'CURSOR_INVALID',
  INPUT_LIMIT_EXCEEDED: 'INPUT_LIMIT_EXCEEDED',
  INPUT_REJECTED: 'INPUT_REJECTED',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  STORAGE_INTEGRITY_ERROR: 'STORAGE_INTEGRITY_ERROR',
  OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN',
} as const;

export type MvpErrorCode = (typeof MVP_ERROR)[keyof typeof MVP_ERROR];

const STATUS: Readonly<Record<MvpErrorCode, number>> = Object.freeze({
  INVALID_REQUEST: 400,
  AUTHENTICATION_REQUIRED: 401,
  INSTANCE_ACCESS_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  TARGET_EXISTS: 409,
  VERSION_CONFLICT: 409,
  PROJECT_BUSY: 409,
  UPLOAD_BUSY: 409,
  BATCH_SEALED: 409,
  RECOVERY_NOT_ALLOWED: 409,
  MANIFEST_NOT_READY: 409,
  CURSOR_INVALID: 409,
  INPUT_LIMIT_EXCEEDED: 413,
  INPUT_REJECTED: 422,
  DEPENDENCY_UNAVAILABLE: 503,
  STORAGE_INTEGRITY_ERROR: 503,
  OUTCOME_UNKNOWN: 503,
});

const MESSAGE: Readonly<Record<MvpErrorCode, string>> = Object.freeze({
  INVALID_REQUEST: '请求格式无效。',
  AUTHENTICATION_REQUIRED: '需要重新登录。',
  INSTANCE_ACCESS_DENIED: '当前身份未获实例准入。',
  RESOURCE_NOT_FOUND: '资源不存在。',
  IDEMPOTENCY_CONFLICT: '同一请求键已用于不同操作或内容。',
  TARGET_EXISTS: '目标已由其他请求占用。',
  VERSION_CONFLICT: '资源版本已变化，请核对当前状态。',
  PROJECT_BUSY: '项目已有正在处理的资料批次。',
  UPLOAD_BUSY: '原上传仍占用当前批次。',
  BATCH_SEALED: '批次已封存，请查询原结果。',
  RECOVERY_NOT_ALLOWED: '当前状态不允许该恢复动作。',
  MANIFEST_NOT_READY: '该批次尚无已封存清单。',
  CURSOR_INVALID: '分页位置无效，请重新加载。',
  INPUT_LIMIT_EXCEEDED: '资料包超出允许的大小或数量限制。',
  INPUT_REJECTED: '资料包未通过安全检查。',
  DEPENDENCY_UNAVAILABLE: '依赖服务暂不可用。',
  STORAGE_INTEGRITY_ERROR: '资料存储校验失败。',
  OUTCOME_UNKNOWN: '原操作结果尚未确定，请核对原请求。',
});

const RETRYABLE: Readonly<Record<MvpErrorCode, boolean>> = Object.freeze({
  INVALID_REQUEST: false,
  AUTHENTICATION_REQUIRED: true,
  INSTANCE_ACCESS_DENIED: false,
  RESOURCE_NOT_FOUND: false,
  IDEMPOTENCY_CONFLICT: false,
  TARGET_EXISTS: false,
  VERSION_CONFLICT: false,
  PROJECT_BUSY: false,
  UPLOAD_BUSY: false,
  BATCH_SEALED: false,
  RECOVERY_NOT_ALLOWED: false,
  MANIFEST_NOT_READY: false,
  CURSOR_INVALID: false,
  INPUT_LIMIT_EXCEEDED: false,
  INPUT_REJECTED: false,
  DEPENDENCY_UNAVAILABLE: true,
  STORAGE_INTEGRITY_ERROR: true,
  OUTCOME_UNKNOWN: true,
});

export class MvpError extends Error {
  readonly code: MvpErrorCode;

  constructor(code: MvpErrorCode) {
    super(code);
    this.name = 'MvpError';
    this.code = code;
  }
}

export function mvpErrorStatus(code: MvpErrorCode): number {
  return STATUS[code];
}

export function mvpErrorMessage(code: MvpErrorCode): string {
  return MESSAGE[code];
}

export function mvpErrorRetryable(code: MvpErrorCode): boolean {
  return RETRYABLE[code];
}

export function fail(code: MvpErrorCode): never {
  throw new MvpError(code);
}

/** Runtime narrowing for Node/pg error codes without an unchecked cast. */
export function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export function errorConstraintOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  return typeof error.constraint === 'string' ? error.constraint : undefined;
}
