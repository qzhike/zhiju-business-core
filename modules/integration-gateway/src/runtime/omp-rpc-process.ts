/* eslint-disable @typescript-eslint/no-unnecessary-condition -- RPC callbacks mutate process state between awaited operations. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { open } from 'node:fs/promises';
import { PreparationError } from '@zhiju/contracts';

export interface OmpProcessRequest {
  executable: string;
  cwd: string;
  overlayPath: string;
  instructionPath: string;
  instructionText: string;
  provider: string;
  model: string;
  thinking: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  environment: NodeJS.ProcessEnv;
  prompt: string;
  eventFile: string;
  deadline: number;
  /** Owning IG persists the invocation claim before this callback returns. */
  beforePrompt(binding: { sessionId: string; systemPromptSha256: string }): Promise<void>;
  signal?: AbortSignal;
  processClosed?(observation: {
    promptSent: boolean;
    eventBytes: number;
    eventSha256: string;
  }): Promise<void>;
}
export interface OmpProcessObservation {
  sessionId: string;
  systemPromptSha256: string;
  promptStatus: 'completed' | 'error' | 'aborted';
  processStopped: true;
  providerCancellationAcknowledged: false;
  eventBytes: number;
  eventSha256: string;
}
const LIMIT = 32 * 1024 * 1024;
function fail(code: string): never {
  throw new PreparationError(code);
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail('INTEGRATION_OMP_PROTOCOL_INVALID');
/** Inspect the actual session before any provider invocation, not just CLI arguments. */
export function verifyOmpStartup(
  value: unknown,
  expected: Pick<OmpProcessRequest, 'provider' | 'model' | 'thinking' | 'instructionText'>,
) {
  const state = record(value),
    model = record(state.model);
  const names = Array.isArray(state.dumpTools)
    ? state.dumpTools.map((tool: unknown) => record(tool).name).sort()
    : [];
  const prompt = Array.isArray(state.systemPrompt)
    ? state.systemPrompt
        .map((block: unknown) => (typeof block === 'string' ? block : ''))
        .join('\n')
    : typeof state.systemPrompt === 'string'
      ? state.systemPrompt
      : '';
  if (
    model.provider !== expected.provider ||
    model.id !== expected.model ||
    state.thinkingLevel !== expected.thinking ||
    state.messageCount !== 0 ||
    state.isStreaming !== false ||
    state.hasPendingAsyncWork !== false ||
    state.autoCompactionEnabled !== false ||
    JSON.stringify(names) !== JSON.stringify(['glob', 'grep', 'read', 'write']) ||
    typeof state.sessionId !== 'string' ||
    !state.sessionId ||
    !expected.instructionText.trim() ||
    !prompt.replace(/\s/gu, '').includes(expected.instructionText.replace(/\s/gu, ''))
  )
    fail('INTEGRATION_OMP_STARTUP_MISMATCH');
  return {
    sessionId: state.sessionId,
    systemPromptSha256: createHash('sha256').update(prompt).digest('hex'),
  };
}

/** One fresh RPC session and one prompt. A transport failure never retries a model call. */
export async function runOmpProcess(input: OmpProcessRequest): Promise<OmpProcessObservation> {
  if (
    !Number.isFinite(input.deadline) ||
    input.deadline <= Date.now() ||
    input.deadline > Date.now() + 3600000 ||
    input.signal?.aborted
  )
    fail('INTEGRATION_OMP_DEADLINE_EXPIRED');
  const journal = await open(input.eventFile, 'wx', 0o600);
  let child: ChildProcessWithoutNullStreams | undefined;
  let bytes = 0,
    buffer = '',
    promptSent = false,
    stopped = false;
  let binding: ReturnType<typeof verifyOmpStartup> | undefined;
  let terminal: OmpProcessObservation['promptStatus'] | undefined;
  let settled = false,
    failure: Error | undefined;
  let writes: Promise<unknown> = Promise.resolve();
  const digest = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  let terminationTimer: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    if (!child || stopped || terminationTimer) return;
    // Only the process group created and retained by this invocation is signalled.
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* close decides stop */
    }
    terminationTimer = setTimeout(() => {
      try {
        if (child?.pid && !stopped) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* close decides */
      }
    }, 3000);
  }
  function reject(code: string) {
    failure ??= new PreparationError(code);
    stop();
  }
  const deadlineTimer = setTimeout(() => {
    reject('INTEGRATION_OMP_PROVIDER_UNKNOWN');
  }, input.deadline - Date.now());
  const abort = () => {
    reject('INTEGRATION_OMP_PROVIDER_UNKNOWN');
  };
  input.signal?.addEventListener('abort', abort, { once: true });
  try {
    child = spawn(
      input.executable,
      [
        '--mode',
        'rpc',
        '--config',
        input.overlayPath,
        '--no-session',
        '--no-title',
        '--no-ui',
        '--no-lsp',
        '--no-pty',
        '--no-extensions',
        '--no-skills',
        '--no-rules',
        '--no-prewalk',
        '--tools',
        'read,grep,glob,write',
        '--model',
        input.provider + '/' + input.model,
        '--thinking',
        input.thinking,
        '--append-system-prompt',
        input.instructionPath,
      ],
      { cwd: input.cwd, env: input.environment, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const processHandle = child;
    const send = (message: unknown) => processHandle.stdin.write(JSON.stringify(message) + '\n');
    let processing: Promise<void> = Promise.resolve();
    function journalFrame(event: Record<string, unknown>) {
      // Keep bounded lifecycle evidence, never hidden thinking, the system prompt,
      // source-bearing tool arguments/results, or a provider transcript.
      if (
        [
          'message_start',
          'message_update',
          'message_end',
          'turn_end',
          'tool_execution_update',
        ].includes(String(event.type))
      )
        return;
      const compact: Record<string, unknown> = { type: event.type };
      for (const key of [
        'id',
        'toolCallId',
        'toolName',
        'success',
        'status',
        'sessionSettled',
        'isError',
      ]) {
        const value = event[key];
        if (typeof value === 'boolean' || (typeof value === 'string' && value.length <= 256))
          compact[key] = value;
      }
      const chunk = Buffer.from(JSON.stringify(compact) + '\n');
      bytes += chunk.length;
      if (bytes > LIMIT) {
        reject('INTEGRATION_OMP_OUTPUT_LIMIT');
        return;
      }
      digest.update(chunk);
      writes = writes
        .then(() => journal.write(chunk))
        .catch(() => {
          reject('INTEGRATION_OMP_JOURNAL_FAILED');
        });
    }
    async function frame(line: string) {
      if (failure || stopped) return;
      let event: Record<string, unknown>;
      try {
        event = record(JSON.parse(line) as unknown);
      } catch {
        reject('INTEGRATION_OMP_PROTOCOL_INVALID');
        return;
      }
      journalFrame(event);
      if (failure) return;
      if (event.type === 'response' && event.id === 'startup') {
        if (binding || event.success !== true) {
          reject('INTEGRATION_OMP_STARTUP_MISMATCH');
          return;
        }
        try {
          binding = verifyOmpStartup(event.data, input);
          await input.beforePrompt(binding);
          if (failure || stopped || input.signal?.aborted) return;
          promptSent = true;
          send({ id: 'analysis', type: 'prompt', message: input.prompt });
        } catch {
          reject('INTEGRATION_OMP_STARTUP_MISMATCH');
        }
      } else if (event.type === 'response' && event.id === 'analysis' && event.success !== true) {
        reject('INTEGRATION_OMP_PROVIDER_UNKNOWN');
      } else if (event.type === 'prompt_result' && event.id === 'analysis') {
        if (!promptSent || !['completed', 'error', 'aborted'].includes(String(event.status))) {
          reject('INTEGRATION_OMP_PROTOCOL_INVALID');
          return;
        }
        terminal = event.status as OmpProcessObservation['promptStatus'];
        settled = event.sessionSettled === true;
        if (settled) stop();
      } else if (event.type === 'session_settled' && terminal) {
        settled = true;
        stop();
      } else if (
        ['auto_retry_start', 'retry_fallback_applied', 'model_changed'].includes(
          String(event.type),
        ) &&
        promptSent
      )
        reject('INTEGRATION_OMP_RUNTIME_DRIFT');
    }
    // The bounded private journal preserves only lifecycle metadata.
    processHandle.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > LIMIT) {
        reject('INTEGRATION_OMP_OUTPUT_LIMIT');
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.trim())
          processing = processing
            .then(() => frame(line))
            .catch(() => {
              reject('INTEGRATION_OMP_PROTOCOL_INVALID');
            });
      }
    });
    // stderr can include credential/provider diagnostics. Bound it without exposing or persisting it.
    let stderrBytes = 0;
    processHandle.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > LIMIT) reject('INTEGRATION_OMP_OUTPUT_LIMIT');
    });
    processHandle.stdin.on('error', () => {
      reject('INTEGRATION_OMP_PROVIDER_UNKNOWN');
    });
    await new Promise<void>((resolve) => {
      processHandle.once('error', () => {
        failure ??= new PreparationError('INTEGRATION_OMP_SPAWN_FAILED');
      });
      processHandle.once('close', () => {
        stopped = true;
        resolve();
      });
      send({ id: 'startup', type: 'get_state' });
    });
    await processing;
    await writes;
    await journal.sync();
    if (failure) throw failure;
    if (!binding || !promptSent || !terminal || !settled) fail('INTEGRATION_OMP_PROVIDER_UNKNOWN');
    return {
      ...binding,
      promptStatus: terminal ?? fail('INTEGRATION_OMP_PROVIDER_UNKNOWN'),
      processStopped: true,
      providerCancellationAcknowledged: false,
      eventBytes: bytes,
      eventSha256: digest.copy().digest('hex'),
    };
  } finally {
    clearTimeout(deadlineTimer);
    if (terminationTimer) clearTimeout(terminationTimer);
    input.signal?.removeEventListener('abort', abort);
    await writes;
    try {
      if (stopped)
        await input.processClosed?.({
          promptSent,
          eventBytes: bytes,
          eventSha256: digest.copy().digest('hex'),
        });
    } finally {
      await journal.close();
    }
  }
}
