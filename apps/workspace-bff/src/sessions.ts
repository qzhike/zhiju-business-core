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
 * Per-browser login generation. Every login attempt is tagged with the
 * generation its binding was on when the attempt was issued; a completed
 * callback claims exactly that generation. The winner advances the generation
 * and drops the session it replaces, so two callbacks issued under one browser
 * binding can never both establish a session and a superseded session cookie
 * never resolves again. The generation is kept as long as it can still be
 * claimed, then pruned with the login transaction that carries it.
 */
interface BrowserBindingState {
  generation: number;
  sessionId: string | undefined;
  updatedAt: number;
}

/**
 * In-memory technical session store. Tokens never leave the process, business
 * payloads are never stored, and capacity exhaustion fails closed instead of
 * evicting an active session.
 */
export class SessionStore {
  private readonly byId = new Map<string, SessionRecord>();
  private readonly byBrowserBinding = new Map<string, BrowserBindingState>();

  constructor(
    private readonly options: {
      maxSessions: number;
      idleMs: number;
      absoluteMs: number;
      /** How long an unclaimed generation survives without a live session. */
      bindingTtlMs: number;
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
    this.byBrowserBinding.set(record.browserBindingId, {
      generation: this.byBrowserBinding.get(record.browserBindingId)?.generation ?? 0,
      sessionId: record.id,
      updatedAt: now,
    });
    return record;
  }

  get(id: string): SessionRecord | undefined {
    const record = this.byId.get(id);
    if (record === undefined) return undefined;
    if (!this.isAlive(record)) {
      this.remove(id);
      return undefined;
    }
    return record;
  }

  invalidate(id: string): void {
    this.remove(id);
  }

  /**
   * True only while this exact record is still the live session stored under
   * its id: an invalidated, replaced or expired session — including one whose
   * generation advanced through a new login — reports false.
   */
  isCurrent(record: SessionRecord): boolean {
    if (this.byId.get(record.id) !== record) return false;
    if (!this.isAlive(record)) {
      this.remove(record.id);
      return false;
    }
    return true;
  }

  /**
   * The generation a login attempt issued now has to present to win. Reading
   * never advances it, so every sibling transaction issued under one browser
   * binding shares one generation until a callback completes.
   */
  bindingGeneration(browserBindingId: string): number {
    const state = this.byBrowserBinding.get(browserBindingId);
    if (state === undefined) return 0;
    state.updatedAt = this.options.now();
    return state.generation;
  }

  /**
   * Single-threaded compare-and-set completion of one browser binding
   * generation: exactly one callback wins per generation. The winner advances
   * the generation and invalidates the session it replaces; a late sibling
   * stops here with no session and no cookie.
   */
  claimBindingGeneration(browserBindingId: string, generation: number): boolean {
    this.prune();
    const state = this.byBrowserBinding.get(browserBindingId);
    const current = state?.generation ?? 0;
    if (current !== generation) return false;
    const replacedSessionId = state?.sessionId;
    if (replacedSessionId !== undefined) this.remove(replacedSessionId);
    this.byBrowserBinding.set(browserBindingId, {
      generation: current + 1,
      sessionId: undefined,
      updatedAt: this.options.now(),
    });
    return true;
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

  private remove(id: string): void {
    const record = this.byId.get(id);
    if (record === undefined) return;
    this.byId.delete(id);
    const state = this.byBrowserBinding.get(record.browserBindingId);
    if (state?.sessionId === id) {
      this.byBrowserBinding.set(record.browserBindingId, { ...state, sessionId: undefined });
    }
  }

  private prune(): void {
    for (const [id, record] of this.byId) {
      if (!this.isAlive(record)) this.remove(id);
    }
    const now = this.options.now();
    for (const [bindingId, state] of this.byBrowserBinding) {
      // A binding with a live session keeps its generation; an unclaimed
      // generation is dropped once no transaction can still present it.
      if (state.sessionId !== undefined) continue;
      if (now - state.updatedAt < this.options.bindingTtlMs) continue;
      this.byBrowserBinding.delete(bindingId);
    }
  }
}
