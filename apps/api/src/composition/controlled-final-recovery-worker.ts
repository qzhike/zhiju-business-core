export interface ControlledFinalRecoveryWorkerConfig {
  readonly intervalMs: number;
  readonly recover: () => Promise<void>;
  readonly onError: (error: unknown) => void | Promise<void>;
}

/** Polls the authorized recovery entry without overlapping runs. */
export class ControlledFinalRecoveryWorker {
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private lastError: unknown;

  constructor(private readonly config: ControlledFinalRecoveryWorkerConfig) {
    if (!Number.isSafeInteger(config.intervalMs) || config.intervalMs <= 0) {
      throw new TypeError('controlled final recovery interval must be a positive integer');
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight?.catch(() => undefined);
  }

  async tick(): Promise<void> {
    if (this.inFlight !== undefined) return this.inFlight;
    const current = this.config.recover();
    this.inFlight = current;
    try {
      await current;
      this.lastError = undefined;
    } finally {
      if (this.inFlight === current) this.inFlight = undefined;
    }
  }

  get failure(): unknown {
    return this.lastError;
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.lastError = error;
      try {
        await this.config.onError(error);
      } catch (reportError) {
        this.lastError = reportError;
      }
    } finally {
      this.schedule(this.config.intervalMs);
    }
  }
}
