import { performance } from 'node:perf_hooks';
// Vitest 4 reporter events stream before the final summary, including hooks.
import { setInterval, clearInterval } from 'node:timers';
import pg from 'pg';

export default class PersistenceProgressReporter {
  active = new Map();
  sampling = false;
  skipped = 0;

  onTestRunStart() {
    this.heartbeat = setInterval(() => {
      for (const [name, started] of this.active) {
        process.stdout.write(
          `[persistence-test] heartbeat: ${name}; elapsedMs=${Math.round(performance.now() - started)}\n`,
        );
      }
      if (this.active.size && !this.sampling) this.pendingSample = this.sampleWaits();
    }, 30_000);
    this.heartbeat.unref();
  }
  async sampleWaits() {
    this.sampling = true;
    const client = new pg.Client({
      connectionString: process.env.ZJU_PERSISTENCE_DATABASE_URL,
      connectionTimeoutMillis: 2_000,
      query_timeout: 4_000,
      statement_timeout: 3_000,
    });
    try {
      await client.connect();
      // Never log SQL text, credentials, URLs or business payloads.
      const result = await client.query(`
        SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers,
               extract(epoch FROM clock_timestamp()-xact_start)::int AS transaction_seconds
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`);
      process.stdout.write(
        `[persistence-test] database activity: ${JSON.stringify(result.rows)}\n`,
      );
    } catch {
      process.stdout.write('[persistence-test] database activity unavailable (diagnostic only)\n');
    } finally {
      try {
        await client.end().catch(() => {
          // A diagnostic connection must not replace the test result.
        });
      } finally {
        this.sampling = false;
      }
    }
  }
  onTestModuleStart(module) {
    this.active.set(`file ${module.moduleId} (including setup/cleanup)`, performance.now());
    process.stdout.write(`[persistence-test] file start: ${module.moduleId}\n`);
  }
  onTestCaseReady(test) {
    this.active.set(test.fullName, performance.now());
    process.stdout.write(`[persistence-test] start: ${test.fullName}\n`);
  }
  onTestCaseResult(test) {
    this.active.delete(test.fullName);
    const result = test.result();
    if (result.state === 'skipped') this.skipped += 1;
    process.stdout.write(
      `[persistence-test] end: ${test.fullName}; state=${result.state}; elapsedMs=${Math.round(test.diagnostic()?.duration ?? 0)}\n`,
    );
    // Preserve failures before a long-running file or CI cancellation can
    // prevent Vitest's final summary from being printed.
    if (result.state === 'failed')
      for (const error of result.errors)
        process.stderr.write(
          `[persistence-test] failure: ${test.fullName}\n${error.stack || `${error.name}: ${error.message}`}\n`,
        );
  }
  onTestModuleEnd(module) {
    this.active.delete(`file ${module.moduleId} (including setup/cleanup)`);
    process.stdout.write(`[persistence-test] file end: ${module.moduleId}\n`);
  }
  async onTestRunEnd() {
    clearInterval(this.heartbeat);
    await this.pendingSample;
    if (this.skipped > 0 && process.env.ZJU_PERSISTENCE_FOCUSED !== '1') {
      throw new Error(`full persistence verification unexpectedly skipped ${this.skipped} tests`);
    }
  }
}
