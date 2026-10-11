/**
 * Bounded, in-memory login transactions: one random transaction per login
 * attempt, single-use, bound to a random browser-binding id cookie. Capacity
 * exhaustion fails closed and never evicts an active session.
 */
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  browserBindingId: string;
  /** The binding generation this attempt must still be on to win. */
  bindingGeneration: number;
  expectedIssuer: string;
  trustConfigHash: string;
  returnTo: string;
  createdAt: number;
  expiresAt: number;
}

export type NewLoginTransaction = Omit<LoginTransaction, 'createdAt' | 'expiresAt'>;

export class TransactionCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionCapacityError';
  }
}

export class LoginTransactionStore {
  private readonly byState = new Map<string, LoginTransaction>();
  private readonly byBrowser = new Map<string, string[]>();

  constructor(
    private readonly options: {
      maxTotal: number;
      maxPerBrowser: number;
      ttlMs: number;
      now: () => number;
    },
  ) {}

  issue(input: NewLoginTransaction): LoginTransaction {
    this.prune();
    if (this.byState.size >= this.options.maxTotal) {
      throw new TransactionCapacityError('login transaction capacity reached');
    }
    const states = this.byBrowser.get(input.browserBindingId) ?? [];
    if (states.length >= this.options.maxPerBrowser) {
      throw new TransactionCapacityError('per-browser login transaction capacity reached');
    }
    const createdAt = this.options.now();
    const transaction: LoginTransaction = {
      ...input,
      createdAt,
      expiresAt: createdAt + this.options.ttlMs,
    };
    this.byState.set(transaction.state, transaction);
    states.push(transaction.state);
    this.byBrowser.set(input.browserBindingId, states);
    return transaction;
  }

  peek(state: string): LoginTransaction | undefined {
    this.prune();
    return this.byState.get(state);
  }

  /**
   * Atomically consumes the transaction. Only the request that presents the
   * matching browser binding can win; everyone else gets undefined and the
   * surviving transaction is left intact for its rightful owner.
   */
  consume(state: string, browserBindingId: string): LoginTransaction | undefined {
    this.prune();
    const transaction = this.byState.get(state);
    if (transaction === undefined) return undefined;
    if (transaction.browserBindingId !== browserBindingId) return undefined;
    this.byState.delete(state);
    const states = this.byBrowser.get(transaction.browserBindingId) ?? [];
    const remaining = states.filter((entry) => entry !== state);
    if (remaining.length === 0) this.byBrowser.delete(transaction.browserBindingId);
    else this.byBrowser.set(transaction.browserBindingId, remaining);
    return transaction;
  }

  private prune(): void {
    const now = this.options.now();
    for (const [state, transaction] of this.byState) {
      if (transaction.expiresAt > now) continue;
      this.byState.delete(state);
      const states = this.byBrowser.get(transaction.browserBindingId) ?? [];
      const remaining = states.filter((entry) => entry !== state);
      if (remaining.length === 0) this.byBrowser.delete(transaction.browserBindingId);
      else this.byBrowser.set(transaction.browserBindingId, remaining);
    }
  }
}
