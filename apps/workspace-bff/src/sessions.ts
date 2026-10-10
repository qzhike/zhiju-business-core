import { randomToken, uuidV7 } from './support.js';

/** Only non-sensitive display fields ever leave the BFF with a session. */
export interface SessionPrincipalSummary {
  principalId: string;
  principalKind: string;
  displayName: string;
}

export interface SessionRecord {
  id: string;
  generation: string;
  browserBindingId: string;
  sessionBinding: string;
  issuer: string;
  subject: string;
  accessToken: string;
  refreshToken: string | undefined;
  accessTokenExpiresAt: number;
  csrfToken: string;
  principal: SessionPrincipalSummary;
  trustConfigHash: string;
  createdAt: number;
  lastActivityAt: number;
  absoluteExpiresAt: number;
  refreshPromise: Promise<RefreshOutcome> | undefined;
}

export interface RefreshedTokens {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string | undefined;
}

export type RefreshOutcome = 'REFRESHED' | 'INVALID';

export type NewSession = Omit<
  SessionRecord,
  'id' | 'generation' | 'createdAt' | 'lastActivityAt' | 'absoluteExpiresAt' | 'refreshPromise'
>;

/**
 * In-memory technical session store. Tokens never leave the process, business
 * payloads are never stored, and capacity exhaustion fails closed instead of
 * evicting an active session.
 */
export class SessionStore {
  private readonly byId = new Map<string, SessionRecord>();

  constructor(
    private readonly options: {
      maxSessions: number;
      idleMs: number;
      absoluteMs: number;
      now: () => number;
    },
  ) {}

  count(): number {
    return this.byId.size;
  }

  create(input: NewSession): SessionRecord | undefined {
    this.prune();
    if (this.byId.size >= this.options.maxSessions) return undefined;
    const now = this.options.now();
    const record: SessionRecord = {
      ...input,
      id: randomToken(32),
      generation: uuidV7(now),
      createdAt: now,
      lastActivityAt: now,
      absoluteExpiresAt: now + this.options.absoluteMs,
      refreshPromise: undefined,
    };
    this.byId.set(record.id, record);
    return record;
  }

  get(id: string): SessionRecord | undefined {
    const record = this.byId.get(id);
    if (record === undefined) return undefined;
    if (!this.isAlive(record)) {
      this.byId.delete(id);
      return undefined;
    }
    return record;
  }

  invalidate(id: string): void {
    this.byId.delete(id);
  }

  isAlive(record: SessionRecord): boolean {
    const now = this.options.now();
    return now < this.idleExpiresAt(record) && now < record.absoluteExpiresAt;
  }

  idleExpiresAt(record: SessionRecord): number {
    return Math.min(record.lastActivityAt + this.options.idleMs, record.absoluteExpiresAt);
  }

  /** At most one idle extension per minute, never beyond the absolute limit. */
  touch(record: SessionRecord): boolean {
    const now = this.options.now();
    if (now - record.lastActivityAt < 60_000) return false;
    record.lastActivityAt = now;
    return true;
  }

  /**
   * Single-flight refresh per session: concurrent callers share one exchange and
   * wait at most `waitMs`. A late result can never resurrect a logged-out
   * session because the record identity is rechecked before any write.
   */
  async refresh(
    record: SessionRecord,
    exchange: (record: SessionRecord) => Promise<RefreshedTokens>,
    waitMs: number,
  ): Promise<RefreshOutcome> {
    const inFlight = record.refreshPromise ?? this.startRefresh(record, exchange);
    const outcome = await this.awaitBounded(inFlight, waitMs);
    if (outcome === 'TIMEOUT') {
      this.invalidate(record.id);
      return 'INVALID';
    }
    return outcome;
  }

  private startRefresh(
    record: SessionRecord,
    exchange: (record: SessionRecord) => Promise<RefreshedTokens>,
  ): Promise<RefreshOutcome> {
    const task = this.runRefresh(record, exchange);
    record.refreshPromise = task;
    return task;
  }

  private async awaitBounded(
    task: Promise<RefreshOutcome>,
    waitMs: number,
  ): Promise<RefreshOutcome | 'TIMEOUT'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'TIMEOUT'>((resolve) => {
      timer = setTimeout(() => {
        resolve('TIMEOUT');
      }, waitMs);
    });
    try {
      return await Promise.race([task, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async runRefresh(
    record: SessionRecord,
    exchange: (record: SessionRecord) => Promise<RefreshedTokens>,
  ): Promise<RefreshOutcome> {
    try {
      const tokens = await exchange(record);
      if (this.byId.get(record.id) !== record) return 'INVALID';
      record.accessToken = tokens.accessToken;
      record.accessTokenExpiresAt = tokens.accessTokenExpiresAt;
      if (tokens.refreshToken !== undefined) record.refreshToken = tokens.refreshToken;
      return 'REFRESHED';
    } catch {
      this.invalidate(record.id);
      return 'INVALID';
    } finally {
      record.refreshPromise = undefined;
    }
  }

  private prune(): void {
    for (const [id, record] of this.byId) {
      if (!this.isAlive(record)) this.byId.delete(id);
    }
  }
}
